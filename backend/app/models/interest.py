"""Interest registered from the public site: early access to a wardrobe, or the studio pilot.

Not an account and not linked to one. Only the owner reads these rows; each holds what the
person typed and the moment they agreed to be contacted. Rows are deleted on request, and
automatically a year after they were last updated (see app/services/interest.py).
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, Index, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.models.enums import InterestKind, InterestRole, sql_in


class Interest(TimestampMixin, Base):
    __tablename__ = "interest"
    __table_args__ = (
        CheckConstraint(f"kind IN ({sql_in(InterestKind)})", name="kind"),
        CheckConstraint(f"role IS NULL OR role IN ({sql_in(InterestRole)})", name="role"),
        # A professional says what they do; someone keeping a wardrobe isn't asked.
        CheckConstraint("(kind = 'studio') = (role IS NOT NULL)", name="role_for_studio"),
        # One row per address and kind: registering again updates it instead of duplicating.
        Index("uq_interest_lower_email_kind", func.lower(text("email")), "kind", unique=True),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    kind: Mapped[str] = mapped_column(String(20))
    role: Mapped[str | None] = mapped_column(String(30))
    name: Mapped[str | None] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(254))
    message: Mapped[str | None] = mapped_column(Text)
    consented_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    contacted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
