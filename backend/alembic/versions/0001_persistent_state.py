"""Create fleet, approvals, mission log, and local import receipt tables."""

from alembic import op
import sqlalchemy as sa


revision = "0001_persistent_state"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fleet_members",
        sa.Column("id", sa.String(length=96), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("tle_line1", sa.String(length=69), nullable=False),
        sa.Column("tle_line2", sa.String(length=69), nullable=False),
        sa.Column("colour", sa.String(length=7), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "approvals",
        sa.Column("spacecraft_id", sa.String(length=96), primary_key=True),
        sa.Column("debris_name", sa.String(length=200), primary_key=True),
        sa.Column("tca", sa.DateTime(timezone=True), primary_key=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_miss_km", sa.Float(), nullable=False),
        sa.Column("decided_score", sa.Float(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("event_miss_km", sa.Float(), nullable=False),
        sa.Column("event_relative_velocity_kms", sa.Float(), nullable=False),
        sa.Column("event_risk_score", sa.Float(), nullable=False),
        sa.Column("event_risk_level", sa.String(length=16), nullable=False),
        sa.CheckConstraint("status IN ('APPROVED', 'REJECTED')", name="ck_approvals_status"),
    )
    op.create_table(
        "mission_log",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("request_id", sa.String(length=36), nullable=True, unique=True),
        sa.Column("logged_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("spacecraft_id", sa.String(length=96), nullable=True),
        sa.Column("spacecraft_name", sa.String(length=200), nullable=False),
        sa.Column("debris_name", sa.String(length=200), nullable=False),
        sa.Column("tca", sa.DateTime(timezone=True), nullable=False),
        sa.Column("miss_distance_km", sa.Float(), nullable=False),
        sa.Column("risk_score", sa.Float(), nullable=False),
        sa.Column("risk_level", sa.String(length=16), nullable=False),
        sa.Column("decision", sa.String(length=16), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("simulated_miss_km", sa.Float(), nullable=False),
        sa.Column("simulated_score", sa.Float(), nullable=False),
        sa.CheckConstraint("decision IN ('APPROVED', 'REJECTED', 'CLEARED')", name="ck_mission_log_decision"),
    )
    op.create_index("ix_mission_log_logged_at_id", "mission_log", ["logged_at", "id"])
    op.create_index("ix_mission_log_spacecraft_logged_at", "mission_log", ["spacecraft_id", "logged_at"])
    op.create_table(
        "local_state_imports",
        sa.Column("migration_id", sa.String(length=36), primary_key=True),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("log_count", sa.Integer(), nullable=False),
        sa.Column("approval_count", sa.Integer(), nullable=False),
        sa.Column("unmatched_approvals_json", sa.Text(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("local_state_imports")
    op.drop_index("ix_mission_log_spacecraft_logged_at", table_name="mission_log")
    op.drop_index("ix_mission_log_logged_at_id", table_name="mission_log")
    op.drop_table("mission_log")
    op.drop_table("approvals")
    op.drop_table("fleet_members")
