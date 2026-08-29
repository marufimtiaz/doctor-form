"""Add ocr_source column to chamber_surveys table.

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-30

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable with no backfill: NULL correctly means "filed before this column
    # existed, or not read yet".
    with op.batch_alter_table("chamber_surveys", schema=None) as batch_op:
        batch_op.add_column(sa.Column("ocr_source", sa.String(length=16), nullable=True))
        batch_op.create_check_constraint(
            "ck_surveys_ocr_source",
            "ocr_source IS NULL OR ocr_source IN ('upload', 'worker', 'admin')",
        )


def downgrade() -> None:
    with op.batch_alter_table("chamber_surveys", schema=None) as batch_op:
        batch_op.drop_constraint("ck_surveys_ocr_source", type_="check")
        batch_op.drop_column("ocr_source")
