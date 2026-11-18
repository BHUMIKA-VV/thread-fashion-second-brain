"""Development-only helpers. This router is mounted only in development and only while
emails go to the local outbox (THREAD_MAIL_PROVIDER=log); see app/main.py. It answers only
requests from this machine: the outbox holds sign-in and password-reset links."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.api.deps import from_this_machine
from app.schemas.auth import OutboxEmail
from app.services.mailer import OUTBOX


def this_machine_only(request: Request) -> None:
    if not from_this_machine(request):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")


router = APIRouter(prefix="/dev", tags=["development"], dependencies=[Depends(this_machine_only)])


@router.get("/outbox", response_model=list[OutboxEmail])
def outbox(to: str = Query(min_length=3, max_length=254)) -> list[OutboxEmail]:
    """Emails "sent" to this address, newest first, so you can click the links locally."""
    wanted = to.strip().lower()
    return [
        OutboxEmail(to=m.to, subject=m.subject, text=m.text, sent_at=m.sent_at)
        for m in reversed(OUTBOX)
        if m.to.lower() == wanted
    ]
