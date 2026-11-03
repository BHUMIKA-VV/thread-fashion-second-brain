"""Anonymous visit counts for the public pages, and the owner's funnel.

What is counted: one visit seeing the landing page, the demo, how it works, the studio pilot or
sign-up, per UTC day and source. The page sends its own name, the host it came from and an
optional ?ref= campaign tag; only the source *category* is kept (instagram, search, direct...).

What is never kept: IP addresses, browsers, cookies, identifiers, full referrer URLs or paths.
A visitor whose browser asks not to be tracked (Global Privacy Control or Do Not Track) is not
counted, and neither are self-declared bots. The network address is used only, in memory, to
rate-limit the endpoint.

Counts are daily totals, so ratios between them are approximate: they are not a per-person
funnel, and can't become one.
"""

import re
from datetime import UTC, date, datetime, timedelta
from urllib.parse import urlsplit

from sqlalchemy import exists, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import Interest, Item, MetricCount, User
from app.models.enums import InterestKind, MetricEvent
from app.schemas.metrics import Funnel, MetricsSummary, SourceCounts, ViewCreate
from app.services.rate_limit import RateLimited, limiter

LIMIT_PER_IP = 60  # per hour: a person browsing never comes close
BOT = re.compile(
    r"bot|crawl|spider|slurp|headless|preview|externalhit|fetch|monitor|python|curl|wget", re.I
)
REF = re.compile(r"^[a-z0-9-]{1,32}$")

# Referring hosts, by category. A host matches a suffix exactly or as a subdomain of it.
SOURCES: dict[str, tuple[str, ...]] = {
    "search": (
        "google.com",
        "google.co.in",
        "bing.com",
        "duckduckgo.com",
        "ecosia.org",
        "yahoo.com",
    ),
    "instagram": ("instagram.com",),
    "facebook": ("facebook.com", "fb.com", "fb.me"),
    "linkedin": ("linkedin.com", "lnkd.in"),
    "whatsapp": ("whatsapp.com", "wa.me"),
    "pinterest": ("pinterest.com", "pinterest.co.in", "pin.it"),
    "x": ("x.com", "twitter.com", "t.co"),
    "youtube": ("youtube.com", "youtu.be"),
    "reddit": ("reddit.com",),
}


def today() -> date:
    return datetime.now(UTC).date()


def host_of(value: str | None) -> str | None:
    """'https://www.Example.com:443/x' or 'www.example.com' -> 'example.com'."""
    if not value:
        return None
    text = value.strip().lower()
    host = urlsplit(text if "//" in text else f"//{text}").hostname
    if not host:
        return None
    return host.removeprefix("www.")


def source_for(referrer: str | None, ref: str | None, own_host: str | None) -> str:
    if ref and REF.fullmatch(ref):
        return f"ref:{ref}"
    host = host_of(referrer)
    if host is None:
        return "direct"
    if host == own_host:
        return "internal"
    for source, suffixes in SOURCES.items():
        if any(host == s or host.endswith(f".{s}") for s in suffixes):
            return source
    return "other"


class MetricsService:
    def __init__(self, db: Session, public_url: str) -> None:
        self.db = db
        self.own_host = host_of(public_url)

    def count_view(
        self, body: ViewCreate, ip: str, user_agent: str | None, opted_out: bool
    ) -> bool:
        """Add one to today's count. Returns whether it was counted; never raises for a
        visitor (an opt-out, a bot or the rate limit just means "not counted")."""
        if opted_out or not user_agent or BOT.search(user_agent):
            return False
        try:
            limiter.hit(f"metrics-ip:{ip}", LIMIT_PER_IP, 3600)
        except RateLimited:
            return False
        source = source_for(body.referrer, body.ref, self.own_host)
        statement = insert(MetricCount).values(
            day=today(), event=body.event.value, source=source, count=1
        )
        self.db.execute(
            statement.on_conflict_do_update(
                index_elements=[MetricCount.day, MetricCount.event, MetricCount.source],
                set_={"count": MetricCount.count + 1},
            )
        )
        self.db.commit()
        return True

    def summary(self, days: int) -> MetricsSummary:
        since = today() - timedelta(days=days - 1)
        rows = self.db.execute(
            select(MetricCount.event, MetricCount.source, func.sum(MetricCount.count))
            .where(MetricCount.day >= since)
            .group_by(MetricCount.event, MetricCount.source)
        ).all()
        events = dict.fromkeys(MetricEvent, 0)
        by_source: dict[str, dict[MetricEvent, int]] = {}
        for event, source, n in rows:
            if event not in MetricEvent.__members__.values():
                continue  # a page no longer counted
            key = MetricEvent(event)
            events[key] += n
            by_source.setdefault(source, {})[key] = by_source.get(source, {}).get(key, 0) + n
        sources = sorted(
            (SourceCounts(source=s, total=sum(e.values()), events=e) for s, e in by_source.items()),
            key=lambda s: (-s.total, s.source),
        )
        return MetricsSummary(
            days=days, since=since, events=events, sources=sources, funnel=self._funnel(since)
        )

    def _funnel(self, since: date) -> Funnel:
        start = datetime.combine(since, datetime.min.time(), UTC)
        new = (
            select(func.count())
            .select_from(User)
            .where(User.is_owner.is_(False), User.created_at >= start)
        )
        has_piece = exists().where(Item.user_id == User.id)
        interest = select(func.count()).select_from(Interest).where(Interest.created_at >= start)
        return Funnel(
            signups=self.db.scalar(new) or 0,
            confirmed=self.db.scalar(new.where(User.email_verified_at.is_not(None))) or 0,
            added_a_piece=self.db.scalar(new.where(has_piece)) or 0,
            wardrobe_interest=self.db.scalar(
                interest.where(Interest.kind == InterestKind.WARDROBE.value)
            )
            or 0,
            studio_interest=self.db.scalar(
                interest.where(Interest.kind == InterestKind.STUDIO.value)
            )
            or 0,
        )
