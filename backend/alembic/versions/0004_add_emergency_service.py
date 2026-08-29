"""Add has_emergency_service column to chamber_surveys table.

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-29

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("chamber_surveys", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "has_emergency_service",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("chamber_surveys", schema=None) as batch_op:
        batch_op.drop_column("has_emergency_service")
