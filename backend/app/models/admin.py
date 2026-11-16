"""What the owner did from the admin pages (M14-7), so support actions can be accounted for.

One row per action: when, which action, the account and payment it was about, and how it
came out. Never an email address, search text or anything Razorpay sent back. Rows outlive
the accounts and payments they mention (their ids become NULL).
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import AdminActionKind, sql_in


class AdminAction(Base):
    __tablename__ = "admin_actions"
    __table_args__ = (
        CheckConstraint(f"action IN ({sql_in(AdminActionKind)})", name="action"),
        Index("ix_admin_actions_created_at", text("created_at DESC")),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    # The moment of the action itself (not the transaction's start), so actions keep their order.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("clock_timestamp()")
    )
    # The owner who acted; NULL once that account is gone.
    actor_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(32))
    account_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    payment_id: Mapped[UUID | None] = mapped_column(ForeignKey("payments.id", ondelete="SET NULL"))
    # A short, fixed word: done, found, not_found, no_change, updated, unavailable, refused.
    outcome: Mapped[str] = mapped_column(String(32))
