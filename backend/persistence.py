"""REST endpoints for persisted fleet state, approvals, and the audit log."""

from __future__ import annotations

import os
import re
import uuid
import json
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import SessionLocal, database_ready, get_db
from models import Approval, FleetMember, MissionLogEntry, MigrationReceipt, utc_now


router = APIRouter(tags=["Persistence"])


class TLEInput(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    line1: str = Field(min_length=69, max_length=69)
    line2: str = Field(min_length=69, max_length=69)


class FleetCreate(BaseModel):
    tle: TLEInput
    colour: str = Field(default="#facc15", pattern=r"^#[0-9a-fA-F]{6}$")
    active: bool = True


class FleetPatch(BaseModel):
    tle: Optional[TLEInput] = None
    colour: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    active: Optional[bool] = None


class FleetRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    tle: TLEInput
    colour: str
    active: bool


class DecisionRequest(BaseModel):
    request_id: uuid.UUID
    spacecraft_id: str = Field(min_length=1, max_length=96)
    spacecraft_name: str = Field(min_length=1, max_length=200)
    debris_name: str = Field(min_length=1, max_length=200)
    tca: datetime
    status: Literal["APPROVED", "REJECTED"]
    decided_miss_km: float = Field(ge=0)
    decided_score: float = Field(ge=0, le=100)
    notes: str = ""
    miss_distance_km: float = Field(ge=0)
    relative_velocity_kms: float = Field(ge=0)
    risk_score: float = Field(ge=0, le=100)
    risk_level: str = Field(min_length=1, max_length=16)


class ClearApprovalRequest(BaseModel):
    request_id: uuid.UUID
    spacecraft_id: str = Field(min_length=1, max_length=96)
    spacecraft_name: str = Field(min_length=1, max_length=200)
    debris_name: str = Field(min_length=1, max_length=200)
    tca: datetime


class LegacyApproval(BaseModel):
    event_key: str
    status: Literal["PENDING", "APPROVED", "REJECTED"]
    decided_at: Optional[datetime] = None
    decided_miss_km: float = 0
    decided_score: float = 0
    notes: str = ""


class LegacyLogEntry(BaseModel):
    id: str
    logged_at: datetime
    spacecraft_name: str
    debris_name: str
    tca: datetime
    miss_distance_km: float
    risk_score: float
    risk_level: str
    decision: Literal["APPROVED", "REJECTED"]
    notes: str = ""
    simulated_miss_km: float
    simulated_score: float


class LocalStateImport(BaseModel):
    migration_id: uuid.UUID
    approvals: dict[str, LegacyApproval] = Field(default_factory=dict)
    mission_log: list[LegacyLogEntry] = Field(default_factory=list)


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return (slug or "spacecraft")[:96]


def _fleet_record(member: FleetMember) -> dict:
    return {
        "id": member.id,
        "tle": {"name": member.name, "line1": member.tle_line1, "line2": member.tle_line2},
        "colour": member.colour,
        "active": member.active,
    }


def _event_key(spacecraft_id: str, debris_name: str, tca: datetime) -> str:
    canonical_tca = _utc(tca).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return f"{spacecraft_id}__{debris_name}__{canonical_tca}"


def _approval_record(approval: Approval) -> dict:
    return {
        "event_key": _event_key(approval.spacecraft_id, approval.debris_name, approval.tca),
        "spacecraft_id": approval.spacecraft_id,
        "status": approval.status,
        "decided_at": _utc(approval.decided_at).isoformat(),
        "decided_miss_km": approval.decided_miss_km,
        "decided_score": approval.decided_score,
        "notes": approval.notes,
    }


def _log_record(entry: MissionLogEntry) -> dict:
    return {
        "id": entry.id,
        "request_id": entry.request_id,
        "logged_at": _utc(entry.logged_at).isoformat(),
        "spacecraft_id": entry.spacecraft_id,
        "spacecraft_name": entry.spacecraft_name,
        "debris_name": entry.debris_name,
        "tca": _utc(entry.tca).isoformat(),
        "miss_distance_km": entry.miss_distance_km,
        "risk_score": entry.risk_score,
        "risk_level": entry.risk_level,
        "decision": entry.decision,
        "notes": entry.notes,
        "simulated_miss_km": entry.simulated_miss_km,
        "simulated_score": entry.simulated_score,
    }


def _new_log_entry(
    *, request_id: Optional[str], spacecraft_id: str, spacecraft_name: str,
    debris_name: str, tca: datetime, miss_distance_km: float, risk_score: float,
    risk_level: str, decision: str, notes: str, simulated_miss_km: float,
    simulated_score: float,
) -> MissionLogEntry:
    return MissionLogEntry(
        id=str(uuid.uuid4()), request_id=request_id, logged_at=utc_now(),
        spacecraft_id=spacecraft_id, spacecraft_name=spacecraft_name,
        debris_name=debris_name, tca=_utc(tca), miss_distance_km=miss_distance_km,
        risk_score=risk_score, risk_level=risk_level, decision=decision,
        notes=notes, simulated_miss_km=simulated_miss_km, simulated_score=simulated_score,
    )


def seed_initial_fleet() -> None:
    initial_iss = {
        "id": "iss-zarya",
        "name": "ISS (ZARYA)",
        "tle_line1": "1 25544U 98067A   24336.50000000  .00002182  00000-0  40769-4 0  9993",
        "tle_line2": "2 25544  51.6416 132.9300 0006703 175.2100  30.8400 15.50377579432188",
        "colour": "#facc15",
        "active": True,
    }
    with SessionLocal.begin() as db:
        if db.scalar(select(func.count()).select_from(FleetMember)) == 0:
            db.add(FleetMember(**initial_iss))


@router.get("/ready", tags=["System"])
def ready() -> dict[str, str]:
    try:
        database_ready()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="database unavailable") from exc
    return {"status": "ready"}


@router.get("/fleet", response_model=list[FleetRecord])
def list_fleet(db: Session = Depends(get_db)) -> list[dict]:
    members = db.scalars(select(FleetMember).order_by(FleetMember.created_at, FleetMember.id)).all()
    return [_fleet_record(member) for member in members]


@router.post("/fleet", response_model=FleetRecord, status_code=201)
def create_fleet_member(body: FleetCreate, db: Session = Depends(get_db)) -> dict:
    member_id = _slugify(body.tle.name)
    if db.get(FleetMember, member_id):
        raise HTTPException(status_code=409, detail="fleet member already exists")
    member = FleetMember(
        id=member_id, name=body.tle.name, tle_line1=body.tle.line1,
        tle_line2=body.tle.line2, colour=body.colour, active=body.active,
    )
    db.add(member)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="fleet member already exists") from exc
    db.refresh(member)
    return _fleet_record(member)


@router.patch("/fleet/{member_id}", response_model=FleetRecord)
def update_fleet_member(member_id: str, body: FleetPatch, db: Session = Depends(get_db)) -> dict:
    member = db.get(FleetMember, member_id)
    if member is None:
        raise HTTPException(status_code=404, detail="fleet member not found")
    changes = body.model_dump(exclude_unset=True)
    if "tle" in changes and changes["tle"] is not None:
        member.name = changes["tle"]["name"]
        member.tle_line1 = changes["tle"]["line1"]
        member.tle_line2 = changes["tle"]["line2"]
    if changes.get("colour") is not None:
        member.colour = changes["colour"]
    if changes.get("active") is not None:
        member.active = changes["active"]
    member.updated_at = utc_now()
    db.commit()
    db.refresh(member)
    return _fleet_record(member)


@router.delete("/fleet/{member_id}", status_code=204)
def delete_fleet_member(member_id: str, db: Session = Depends(get_db)) -> Response:
    member = db.get(FleetMember, member_id)
    if member is None:
        raise HTTPException(status_code=404, detail="fleet member not found")
    db.execute(delete(Approval).where(Approval.spacecraft_id == member_id))
    db.delete(member)
    db.commit()
    return Response(status_code=204)


@router.get("/approvals")
def list_approvals(
    spacecraft_id: Optional[str] = None,
    db: Session = Depends(get_db),
) -> list[dict]:
    statement = select(Approval).order_by(Approval.decided_at.desc())
    if spacecraft_id:
        statement = statement.where(Approval.spacecraft_id == spacecraft_id)
    return [_approval_record(row) for row in db.scalars(statement).all()]


@router.put("/approvals")
def save_approval(body: DecisionRequest, db: Session = Depends(get_db)) -> dict:
    request_id = str(body.request_id)
    with db.begin():
        previous_log = db.scalar(select(MissionLogEntry).where(MissionLogEntry.request_id == request_id))
        if previous_log is not None:
            existing = db.get(Approval, (body.spacecraft_id, body.debris_name, _utc(body.tca)))
            return {
                "approval": _approval_record(existing) if existing else None,
                "log_entry": _log_record(previous_log),
            }

        tca = _utc(body.tca)
        approval = db.get(Approval, (body.spacecraft_id, body.debris_name, tca))
        if approval is None:
            approval = Approval(
                spacecraft_id=body.spacecraft_id, debris_name=body.debris_name, tca=tca,
                status=body.status, decided_at=utc_now(), decided_miss_km=body.decided_miss_km,
                decided_score=body.decided_score, notes=body.notes,
                event_miss_km=body.miss_distance_km,
                event_relative_velocity_kms=body.relative_velocity_kms,
                event_risk_score=body.risk_score, event_risk_level=body.risk_level,
            )
            db.add(approval)
        else:
            approval.status = body.status
            approval.decided_at = utc_now()
            approval.decided_miss_km = body.decided_miss_km
            approval.decided_score = body.decided_score
            approval.notes = body.notes
            approval.event_miss_km = body.miss_distance_km
            approval.event_relative_velocity_kms = body.relative_velocity_kms
            approval.event_risk_score = body.risk_score
            approval.event_risk_level = body.risk_level

        log_entry = _new_log_entry(
            request_id=request_id, spacecraft_id=body.spacecraft_id,
            spacecraft_name=body.spacecraft_name, debris_name=body.debris_name,
            tca=tca, miss_distance_km=body.miss_distance_km,
            risk_score=body.risk_score, risk_level=body.risk_level,
            decision=body.status, notes=body.notes,
            simulated_miss_km=body.decided_miss_km, simulated_score=body.decided_score,
        )
        db.add(log_entry)
        db.flush()
        result = {"approval": _approval_record(approval), "log_entry": _log_record(log_entry)}
    return result


@router.post("/approvals/clear")
def clear_approval(body: ClearApprovalRequest, db: Session = Depends(get_db)) -> dict:
    request_id = str(body.request_id)
    tca = _utc(body.tca)
    with db.begin():
        previous_log = db.scalar(select(MissionLogEntry).where(MissionLogEntry.request_id == request_id))
        if previous_log is not None:
            current = db.get(Approval, (body.spacecraft_id, body.debris_name, tca))
            return {
                "approval": _approval_record(current) if current else None,
                "log_entry": _log_record(previous_log),
            }

        approval = db.get(Approval, (body.spacecraft_id, body.debris_name, tca))
        miss_km = approval.event_miss_km if approval else 0.0
        risk_score = approval.event_risk_score if approval else 0.0
        risk_level = approval.event_risk_level if approval else "UNKNOWN"
        simulated_miss_km = approval.decided_miss_km if approval else 0.0
        simulated_score = approval.decided_score if approval else risk_score
        if approval is not None:
            db.delete(approval)
        log_entry = _new_log_entry(
            request_id=request_id, spacecraft_id=body.spacecraft_id,
            spacecraft_name=body.spacecraft_name, debris_name=body.debris_name,
            tca=tca, miss_distance_km=miss_km, risk_score=risk_score,
            risk_level=risk_level, decision="CLEARED", notes="",
            simulated_miss_km=simulated_miss_km, simulated_score=simulated_score,
        )
        db.add(log_entry)
        db.flush()
        result = {"approval": None, "log_entry": _log_record(log_entry)}
    return result


@router.get("/mission-log")
def list_mission_log(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> dict:
    total = db.scalar(select(func.count()).select_from(MissionLogEntry)) or 0
    entries = db.scalars(
        select(MissionLogEntry)
        .order_by(MissionLogEntry.logged_at.desc(), MissionLogEntry.id.desc())
        .offset(offset).limit(limit)
    ).all()
    return {
        "items": [_log_record(entry) for entry in entries],
        "total": total,
        "offset": offset,
        "limit": limit,
        "has_more": offset + len(entries) < total,
    }


@router.post("/state/import-local")
def import_local_state(body: LocalStateImport, db: Session = Depends(get_db)) -> dict:
    enabled = os.getenv("ALLOW_LOCAL_STATE_IMPORT", "true").lower() in {"1", "true", "yes"}
    if not enabled:
        raise HTTPException(status_code=404, detail="local-state import is disabled")

    migration_id = str(body.migration_id)
    with db.begin():
        receipt = db.get(MigrationReceipt, migration_id)
        if receipt is not None:
            return {
                "imported": True,
                "already_imported": True,
                "mission_log_count": receipt.log_count,
                "approval_count": receipt.approval_count,
                "unmatched_approvals": json.loads(receipt.unmatched_approvals_json),
            }

        imported_logs = 0
        log_by_legacy_event: dict[tuple[str, datetime], list[LegacyLogEntry]] = {}
        for legacy in body.mission_log:
            log_by_legacy_event.setdefault((legacy.debris_name, _utc(legacy.tca)), []).append(legacy)
            legacy_id = legacy.id[:64]
            if db.get(MissionLogEntry, legacy_id) is not None:
                continue
            db.add(MissionLogEntry(
                id=legacy_id, request_id=None, logged_at=_utc(legacy.logged_at),
                spacecraft_id=_slugify(legacy.spacecraft_name), spacecraft_name=legacy.spacecraft_name,
                debris_name=legacy.debris_name, tca=_utc(legacy.tca),
                miss_distance_km=legacy.miss_distance_km, risk_score=legacy.risk_score,
                risk_level=legacy.risk_level, decision=legacy.decision, notes=legacy.notes,
                simulated_miss_km=legacy.simulated_miss_km, simulated_score=legacy.simulated_score,
            ))
            imported_logs += 1

        imported_approvals = 0
        unmatched: list[str] = []
        for old_key, legacy in body.approvals.items():
            if legacy.status == "PENDING":
                continue
            try:
                legacy_debris, legacy_tca = old_key.rsplit("__", 1)
                parsed_tca = datetime.fromisoformat(legacy_tca.replace("Z", "+00:00"))
                candidates = log_by_legacy_event.get((legacy_debris, _utc(parsed_tca)), [])
            except ValueError:
                unmatched.append(old_key)
                continue
            if not legacy_debris:
                unmatched.append(old_key)
                continue
            distinct_spacecraft = {_slugify(entry.spacecraft_name) for entry in candidates}
            source_log = max(candidates, key=lambda entry: _utc(entry.logged_at)) if candidates else None
            # Old approval keys were global by debris/TCA. Scope only when the
            # old mission log gives one unambiguous spacecraft; otherwise keep
            # a legacy wildcard so the prior decision is still visible.
            spacecraft_id = next(iter(distinct_spacecraft)) if len(distinct_spacecraft) == 1 else "legacy"
            tca = _utc(parsed_tca)
            event_miss_km = source_log.miss_distance_km if source_log else legacy.decided_miss_km
            event_risk_score = source_log.risk_score if source_log else legacy.decided_score
            event_risk_level = source_log.risk_level if source_log else "UNKNOWN"
            approval = db.get(Approval, (spacecraft_id, legacy_debris, tca))
            if approval is None:
                approval = Approval(
                    spacecraft_id=spacecraft_id, debris_name=legacy_debris, tca=tca,
                    status=legacy.status, decided_at=_utc(legacy.decided_at) if legacy.decided_at else _utc(source_log.logged_at) if source_log else utc_now(),
                    decided_miss_km=legacy.decided_miss_km, decided_score=legacy.decided_score,
                    notes=legacy.notes, event_miss_km=event_miss_km,
                    event_relative_velocity_kms=0.0, event_risk_score=event_risk_score,
                    event_risk_level=event_risk_level,
                )
                db.add(approval)
            imported_approvals += 1

        receipt = MigrationReceipt(
            migration_id=migration_id, imported_at=utc_now(),
            log_count=imported_logs, approval_count=imported_approvals,
            unmatched_approvals_json=json.dumps(unmatched),
        )
        db.add(receipt)
        db.flush()

    return {
        "imported": True,
        "already_imported": False,
        "mission_log_count": imported_logs,
        "approval_count": imported_approvals,
        "unmatched_approvals": unmatched,
    }
