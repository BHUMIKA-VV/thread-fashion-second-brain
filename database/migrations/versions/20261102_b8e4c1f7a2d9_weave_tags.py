"""weave_tags: allow the weave tag category

Widens the tags category check to accept 'weave', which people record by hand (the image
model never suggests it). No data changes on upgrade. Downgrade deletes weave tags first,
because the narrower check would refuse them; every other tag is kept.

Revision ID: b8e4c1f7a2d9
Revises: a6d3f1c8e2b7
Create Date: 2026-11-02 12:00:00+00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "b8e4c1f7a2d9"
down_revision: str | None = "a6d3f1c8e2b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BEFORE = "'garment', 'silhouette', 'pattern', 'fabric', 'aesthetic', 'occasion', 'craft'"
AFTER = "'garment', 'silhouette', 'pattern', 'fabric', 'weave', 'aesthetic', 'occasion', 'craft'"


def upgrade() -> None:
    op.drop_constraint(op.f("ck_tags_category"), "tags", type_="check")
    op.create_check_constraint(op.f("ck_tags_category"), "tags", f"category IN ({AFTER})")


def downgrade() -> None:
    # Weave tags cannot satisfy the old constraint; they are removed, everything else is kept.
    op.execute("DELETE FROM tags WHERE category = 'weave'")
    op.drop_constraint(op.f("ck_tags_category"), "tags", type_="check")
    op.create_check_constraint(op.f("ck_tags_category"), "tags", f"category IN ({BEFORE})")
