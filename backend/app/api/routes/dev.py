"""Development-only helpers. This router is mounted only outside production and only while
emails go to the local outbox (THREAD_MAIL_PROVIDER=log); see app/main.py."""

from fastapi import APIRouter, Query

from app.schemas.auth import OutboxEmail
from app.services.mailer import OUTBOX

router = APIRouter(prefix="/dev", tags=["development"])


@router.get("/outbox", response_model=list[OutboxEmail])
def outbox(to: str = Query(min_length=3, max_length=254)) -> list[OutboxEmail]:
    """Emails "sent" to this address, newest first, so you can click the links locally."""
    wanted = to.strip().lower()
    return [
        OutboxEmail(to=m.to, subject=m.subject, text=m.text, sent_at=m.sent_at)
        for m in reversed(OUTBOX)
        if m.to.lower() == wanted
    ]
