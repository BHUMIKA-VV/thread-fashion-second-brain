"""Anonymous visit counts: how many visits saw a public page, per day and source.

A row is a number, nothing more: no address, browser, cookie or identifier is stored, so no
count can be traced to a person. See app/services/metrics.py for what is counted and how.
"""

from datetime import date

from sqlalchemy import CheckConstraint, Date, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MetricCount(Base):
    __tablename__ = "metric_counts"
    __table_args__ = (
        CheckConstraint("event ~ '^[a-z_]{1,40}$'", name="event"),
        CheckConstraint("source ~ '^(ref:)?[a-z0-9-]{1,32}$'", name="source"),
        CheckConstraint("count >= 0", name="count"),
    )

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    event: Mapped[str] = mapped_column(String(40), primary_key=True)
    source: Mapped[str] = mapped_column(String(40), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, server_default=text("0"))
