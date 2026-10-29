"""Account emails: verification, password reset and "you already have an account".

`LogMailer` (development and tests) sends nothing: it logs that a message was written and
keeps the last few in memory, where the development-only outbox endpoint can show them.
`ResendMailer` sends through Resend's HTTP API with the key from THREAD_RESEND_API_KEY.
"""

import logging
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

import httpx

from app.core.config import Settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    text: str
    sent_at: datetime


class Mailer(Protocol):
    def send(self, to: str, subject: str, text: str) -> None: ...


# Development and tests only; never populated in production (see get_mailer).
OUTBOX: deque[Email] = deque(maxlen=50)


class LogMailer:
    def send(self, to: str, subject: str, text: str) -> None:
        OUTBOX.append(Email(to, subject, text, datetime.now(UTC)))
        # The address and body stay out of the log: links in them are sign-in secrets.
        logger.info("Email written to the local outbox (subject: %s)", subject)


class ResendMailer:
    def __init__(self, api_key: str, sender: str) -> None:
        self._api_key = api_key
        self._sender = sender

    def send(self, to: str, subject: str, text: str) -> None:
        try:
            response = httpx.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {self._api_key}"},
                json={"from": self._sender, "to": [to], "subject": subject, "text": text},
                timeout=10,
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            # Never block or fail the request on mail delivery; the user can ask again.
            logger.error("Email could not be sent (%s)", exc.__class__.__name__)


def get_mailer(settings: Settings) -> Mailer:
    if settings.mail_provider == "resend" and settings.resend_api_key is not None:
        return ResendMailer(settings.resend_api_key.get_secret_value(), settings.email_from)
    return LogMailer()
