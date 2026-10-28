"""SQLAlchemy models for fleet configuration and operator decision history."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, Index, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class FleetMember(Base):
    __tablename__ = "fleet_members"

    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    tle_line1: Mapped[str] = mapped_column(String(69), nullable=False)
    tle_line2: Mapped[str] = mapped_column(String(69), nullable=False)
    colour: Mapped[str] = mapped_column(String(7), nullable=False, default="#facc15")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)


class Approval(Base):
    __tablename__ = "approvals"
    __table_args__ = (
        CheckConstraint("status IN ('APPROVED', 'REJECTED')", name="ck_approvals_status"),
    )

    spacecraft_id: Mapped[str] = mapped_column(String(96), primary_key=True)
    debris_name: Mapped[str] = mapped_column(String(200), primary_key=True)
    tca: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    decided_miss_km: Mapped[float] = mapped_column(Float, nullable=False)
    decided_score: Mapped[float] = mapped_column(Float, nullable=False)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    event_miss_km: Mapped[float] = mapped_column(Float, nullable=False)
    event_relative_velocity_kms: Mapped[float] = mapped_column(Float, nullable=False)
    event_risk_score: Mapped[float] = mapped_column(Float, nullable=False)
    event_risk_level: Mapped[str] = mapped_column(String(16), nullable=False)


class MissionLogEntry(Base):
    __tablename__ = "mission_log"
    __table_args__ = (
        CheckConstraint("decision IN ('APPROVED', 'REJECTED', 'CLEARED')", name="ck_mission_log_decision"),
        Index("ix_mission_log_logged_at_id", "logged_at", "id"),
        Index("ix_mission_log_spacecraft_logged_at", "spacecraft_id", "logged_at"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_id: Mapped[Optional[str]] = mapped_column(String(36), unique=True, nullable=True)
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    spacecraft_id: Mapped[Optional[str]] = mapped_column(String(96), nullable=True)
    spacecraft_name: Mapped[str] = mapped_column(String(200), nullable=False)
    debris_name: Mapped[str] = mapped_column(String(200), nullable=False)
    tca: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    miss_distance_km: Mapped[float] = mapped_column(Float, nullable=False)
    risk_score: Mapped[float] = mapped_column(Float, nullable=False)
    risk_level: Mapped[str] = mapped_column(String(16), nullable=False)
    decision: Mapped[str] = mapped_column(String(16), nullable=False)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    simulated_miss_km: Mapped[float] = mapped_column(Float, nullable=False)
    simulated_score: Mapped[float] = mapped_column(Float, nullable=False)


class MigrationReceipt(Base):
    __tablename__ = "local_state_imports"

    migration_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    log_count: Mapped[int] = mapped_column(Integer, nullable=False)
    approval_count: Mapped[int] = mapped_column(Integer, nullable=False)
    unmatched_approvals_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
