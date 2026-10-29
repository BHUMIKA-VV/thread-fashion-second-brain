"""Deep analysis (Claude vision) results and the daily usage counter.

One row per item holds both the latest attempt (status, run_id, error) and the last
successful result. They are kept apart so a failed re-run never erases a good analysis, and
nothing here touches the item's own analysis stages (palette, embedding, tags).
"""

from datetime import date, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.models.enums import DeepAnalysisStatus, sql_in


class DeepAnalysis(TimestampMixin, Base):
    __tablename__ = "deep_analyses"
    __table_args__ = (
        # The analysis and its item always belong to the same owner (checked by the database).
        ForeignKeyConstraint(
            ["item_id", "user_id"],
            ["items.id", "items.user_id"],
            ondelete="CASCADE",
            name="fk_deep_analyses_item_owner",
        ),
        CheckConstraint(f"status IN ({sql_in(DeepAnalysisStatus)})", name="status"),
        CheckConstraint("input_tokens IS NULL OR input_tokens >= 0", name="input_tokens"),
        CheckConstraint("output_tokens IS NULL OR output_tokens >= 0", name="output_tokens"),
        # Counting runs in flight (the global concurrency limit) reads only these rows.
        Index(
            "ix_deep_analyses_running_started_at",
            "started_at",
            postgresql_where=text("status = 'running'"),
        ),
    )

    item_id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column()

    # The latest attempt.
    run_id: Mapped[UUID] = mapped_column()
    status: Mapped[str] = mapped_column(String(20))
    requested_model: Mapped[str] = mapped_column(String(100))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # User-safe outcome only; provider details go to the logs.
    error_code: Mapped[str | None] = mapped_column(String(40))
    error_message: Mapped[str | None] = mapped_column(Text)
    retry_after_seconds: Mapped[int | None] = mapped_column(Integer)

    # The last successful result (kept when a later attempt fails).
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    result_model: Mapped[str | None] = mapped_column(String(100))  # the model that answered
    result_prompt_version: Mapped[str | None] = mapped_column(String(20))
    result_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)


class DeepAnalysisUsage(Base):
    """Runs started per user per UTC day. Separate from deep_analyses so deleting a piece or
    re-running one never resets the count."""

    __tablename__ = "deep_analysis_usage"
    __table_args__ = (CheckConstraint("runs >= 0", name="runs"),)

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    runs: Mapped[int] = mapped_column(Integer, server_default=text("0"))
