"""ocr columns

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-28 02:02:22.582340

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = '0003'
down_revision: Union[str, Sequence[str], None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('chamber_surveys', schema=None) as batch_op:
        batch_op.add_column(sa.Column('ocr_attempts', sa.Integer(), server_default='0', nullable=False))
        batch_op.add_column(sa.Column('ocr_error', sqlmodel.sql.sqltypes.AutoString(length=1000), nullable=True))
        batch_op.add_column(sa.Column('ocr_started_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('ocr_next_attempt_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('ocr_completed_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.create_index(batch_op.f('ix_chamber_surveys_ocr_next_attempt_at'), ['ocr_next_attempt_at'], unique=False)
        batch_op.drop_constraint('ck_surveys_ocr_status', type_='check')
        batch_op.create_check_constraint(
            'ck_surveys_ocr_status',
            "ocr_status IN ('pending', 'processing', 'done', 'failed')",
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('chamber_surveys', schema=None) as batch_op:
        batch_op.drop_constraint('ck_surveys_ocr_status', type_='check')
        batch_op.create_check_constraint(
            'ck_surveys_ocr_status',
            "ocr_status IN ('pending', 'done', 'failed')",
        )
        batch_op.drop_index(batch_op.f('ix_chamber_surveys_ocr_next_attempt_at'))
        batch_op.drop_column('ocr_completed_at')
        batch_op.drop_column('ocr_next_attempt_at')
        batch_op.drop_column('ocr_started_at')
        batch_op.drop_column('ocr_error')
        batch_op.drop_column('ocr_attempts')
