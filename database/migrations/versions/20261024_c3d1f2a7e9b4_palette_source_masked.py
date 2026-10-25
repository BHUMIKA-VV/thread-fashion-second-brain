"""allow palettes.source = 'masked' (plain backdrop excluded)

Revision ID: c3d1f2a7e9b4
Revises: b987c40bd0a0
Create Date: 2026-10-24 19:00:00+00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "c3d1f2a7e9b4"
down_revision: str | None = "b987c40bd0a0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(op.f("ck_palettes_source"), "palettes", type_="check")
    op.create_check_constraint(
        op.f("ck_palettes_source"), "palettes", "source IN ('cutout', 'original', 'masked')"
    )


def downgrade() -> None:
    # Rows using the new value cannot satisfy the old constraint; relabel them first.
    op.execute("UPDATE palettes SET source = 'original' WHERE source = 'masked'")
    op.drop_constraint(op.f("ck_palettes_source"), "palettes", type_="check")
    op.create_check_constraint(
        op.f("ck_palettes_source"), "palettes", "source IN ('cutout', 'original')"
    )
