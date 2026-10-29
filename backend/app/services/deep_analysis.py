"""Starting, running and reading deep analyses (see app/ml/deep_analyzer.py for the model call).

Flow (no worker queue yet):
1. POST claims a run in one short transaction under an advisory lock: one active run per item,
   at most MAX_CONCURRENT_RUNS in flight overall, and the per-user daily cap. It answers 202.
2. The run happens after the response, in a background thread with its own session. No
   transaction is held open during the call to Claude.
3. The outcome is written only if this run is still the item's current run and the item still
   exists; it touches deep_analyses and items.ai_description[_model] and nothing else.
A run that never reports back (say the server restarted) is treated as failed once it is older
than STALE_AFTER, so it never blocks the item or a concurrency slot for good.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from pydantic import ValidationError
from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.ml.deep_analyzer import (
    PROMPT_VERSION,
    AnalysisInput,
    DeepAnalysisError,
    DeepAnalysisResult,
    DeepAnalyzer,
    prepare_image,
)
from app.models import DeepAnalysis, DeepAnalysisUsage, Item
from app.models.enums import DeepAnalysisStatus
from app.repositories.errors import NotFoundError
from app.repositories.items import ItemRepository
from app.services.tags import TagService
from app.storage import Storage
from app.storage.base import StorageError

logger = logging.getLogger(__name__)

MAX_CONCURRENT_RUNS = 2
# Longer than the worst case of one call: timeout x (1 + 2 retries) plus backoff.
STALE_AFTER = timedelta(minutes=10)
# Arbitrary constant naming the claim lock (pg_advisory_xact_lock is released on commit).
CLAIM_LOCK_ID = 7_061_001
UTC_TODAY = text("(now() AT TIME ZONE 'UTC')::date")

RUNNING = DeepAnalysisStatus.RUNNING.value
INTERRUPTED = DeepAnalysisError(
    "interrupted", "The analysis was interrupted (the server may have restarted). Try again."
)


class DeepAnalysisUnavailable(Exception):
    """No analyzer is configured (maps to 503)."""


class DeepAnalysisRefused(Exception):
    """A run cannot start now: already running (409), busy or daily limit (429)."""

    def __init__(self, code: str, message: str, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class Claim:
    item_id: UUID
    owner_id: UUID
    run_id: UUID


def _is_stale(row: DeepAnalysis, now: datetime) -> bool:
    return row.status == RUNNING and row.started_at < now - STALE_AFTER


class DeepAnalysisService:
    def __init__(
        self, db: Session, settings: Settings, owner_id: UUID, analyzer: DeepAnalyzer | None
    ) -> None:
        self.db = db
        self.settings = settings
        self.owner_id = owner_id
        self.analyzer = analyzer
        self.items = ItemRepository(db, owner_id)

    def runs_today(self) -> int:
        return (
            self.db.scalar(
                select(DeepAnalysisUsage.runs).where(
                    DeepAnalysisUsage.user_id == self.owner_id, DeepAnalysisUsage.day == UTC_TODAY
                )
            )
            or 0
        )

    def get(self, item_id: UUID) -> DeepAnalysis | None:
        """The item's analysis row (None if never run), with stale runs reported as failed."""
        self.items.get_or_raise(item_id)
        row = self.db.get(DeepAnalysis, item_id)
        now = self.db.scalar(select(func.now()))
        if row is not None and _is_stale(row, now):
            _finish(self.db, Claim(item_id, self.owner_id, row.run_id), error=INTERRUPTED)
            self.db.refresh(row)
        return row

    def start(self, item_id: UUID) -> Claim:
        if self.analyzer is None:
            raise DeepAnalysisUnavailable("Deep analysis is not configured.")
        self.items.get_or_raise(item_id)
        # Serialise claims (across processes too) so the checks below cannot race.
        self.db.execute(select(func.pg_advisory_xact_lock(CLAIM_LOCK_ID)))
        now = self.db.scalar(select(func.now()))
        row = self.db.get(DeepAnalysis, item_id, populate_existing=True)
        if row is not None and row.status == RUNNING and not _is_stale(row, now):
            raise DeepAnalysisRefused(
                "already_running", "This piece is already being analysed.", 409
            )
        in_flight = self.db.scalar(
            select(func.count())
            .select_from(DeepAnalysis)
            .where(DeepAnalysis.status == RUNNING, DeepAnalysis.started_at >= now - STALE_AFTER)
        )
        if in_flight >= MAX_CONCURRENT_RUNS:
            raise DeepAnalysisRefused(
                "busy", "Two analyses are already running. Try again in a minute.", 429
            )
        limit = self.settings.deep_analysis_daily_limit
        # The cap guards spending: the local fake analyzer costs nothing and is not counted.
        counts = self.analyzer.provider != "fake"
        counted = (
            self.db.scalar(
                insert(DeepAnalysisUsage)
                .values(user_id=self.owner_id, day=UTC_TODAY, runs=1)
                .on_conflict_do_update(
                    index_elements=[DeepAnalysisUsage.user_id, DeepAnalysisUsage.day],
                    set_={"runs": DeepAnalysisUsage.runs + 1},
                    where=DeepAnalysisUsage.runs < limit,
                )
                .returning(DeepAnalysisUsage.runs)
            )
            if counts and limit > 0
            else None
        )
        if counts and counted is None:
            self.db.rollback()
            raise DeepAnalysisRefused(
                "daily_limit_reached",
                f"The daily limit of {limit} deep analyses has been reached (it resets at "
                "midnight UTC).",
                429,
            )

        run_id = uuid4()
        attempt = {
            "run_id": run_id,
            "status": RUNNING,
            "requested_model": self.analyzer.model,
            "started_at": func.clock_timestamp(),
            "finished_at": None,
            "error_code": None,
            "error_message": None,
            "retry_after_seconds": None,
        }
        self.db.execute(
            insert(DeepAnalysis)
            .values(item_id=item_id, user_id=self.owner_id, **attempt)
            # Keeps the last successful result columns as they are.
            .on_conflict_do_update(index_elements=[DeepAnalysis.item_id], set_=attempt)
        )
        self.db.commit()
        self.db.expire_all()
        logger.info("Deep analysis %s claimed for item %s", run_id, item_id)
        return Claim(item_id, self.owner_id, run_id)


def _finish(
    db: Session,
    claim: Claim,
    *,
    error: DeepAnalysisError | None = None,
    result: dict[str, Any] | None = None,
    model: str | None = None,
    tokens: tuple[int | None, int | None] = (None, None),
) -> bool:
    """Record the outcome if `claim` is still the current run. False if superseded or deleted."""
    current = (
        DeepAnalysis.item_id == claim.item_id,
        DeepAnalysis.user_id == claim.owner_id,
        DeepAnalysis.run_id == claim.run_id,
        DeepAnalysis.status == RUNNING,
    )
    values: dict[str, Any] = {"finished_at": func.clock_timestamp()}
    if error is not None:
        values |= {
            "status": DeepAnalysisStatus.FAILED.value,
            "error_code": error.code,
            "error_message": error.message,
            "retry_after_seconds": error.retry_after,
        }
    else:
        values |= {
            "status": DeepAnalysisStatus.COMPLETED.value,
            "result": result,
            "result_model": model,
            "result_prompt_version": PROMPT_VERSION,
            "result_at": func.clock_timestamp(),
            "input_tokens": tokens[0],
            "output_tokens": tokens[1],
        }
    updated = db.execute(update(DeepAnalysis).where(*current).values(**values)).rowcount
    if updated and result is not None:
        db.execute(
            update(Item)
            .where(Item.id == claim.item_id, Item.user_id == claim.owner_id)
            .values(ai_description=result["summary"], ai_description_model=model)
        )
    db.commit()
    return bool(updated)


def _input_for(db: Session, storage: Storage, settings: Settings, claim: Claim) -> AnalysisInput:
    item = ItemRepository(db, claim.owner_id).get_or_raise(claim.item_id)
    colours = [c.get("name", "") for c in (item.palette.colors if item.palette else [])]
    shown, _removed = TagService(db).effective(item)
    try:
        original = storage.read(item.original_key)
    except StorageError as exc:
        raise DeepAnalysisError("image_unreadable", "The stored image could not be read.") from exc
    return AnalysisInput(
        image_jpeg=prepare_image(original, settings.max_image_pixels),
        colour_names=[c for c in colours if c],
        tags=[(t.category, t.tag) for t in shown],
    )


def run_deep_analysis(
    session_factory: sessionmaker[Session],
    storage: Storage,
    settings: Settings,
    analyzer: DeepAnalyzer,
    claim: Claim,
) -> None:
    """Background task: never raises; every outcome is recorded on the run (if still current)."""
    with session_factory() as db:
        outcome: dict[str, Any]
        try:
            data = _input_for(db, storage, settings, claim)
            db.rollback()  # end the read transaction before the (slow) call to Claude
            output = analyzer.analyze(data)
            outcome = {
                "result": output.result.model_dump(mode="json"),
                "model": output.model,
                "tokens": (output.input_tokens, output.output_tokens),
            }
        except NotFoundError:
            db.rollback()
            logger.info("Deep analysis %s: item %s was deleted", claim.run_id, claim.item_id)
            return
        except DeepAnalysisError as exc:
            db.rollback()
            outcome = {"error": exc}
        except Exception:
            db.rollback()
            logger.exception("Deep analysis %s failed unexpectedly", claim.run_id)
            outcome = {"error": DeepAnalysisError("internal", "The analysis failed. Try again.")}

        try:
            if not _finish(db, claim, **outcome):
                logger.info(
                    "Deep analysis %s outcome discarded (superseded or item deleted)", claim.run_id
                )
        except Exception:
            db.rollback()
            logger.exception("Deep analysis %s: could not record the outcome", claim.run_id)


def stored_result(row: DeepAnalysis) -> DeepAnalysisResult | None:
    """The stored result, or None if it no longer matches the current schema."""
    if row.result is None:
        return None
    try:
        return DeepAnalysisResult.model_validate(row.result)
    except ValidationError:
        logger.warning("Stored deep analysis for item %s does not match the schema", row.item_id)
        return None
