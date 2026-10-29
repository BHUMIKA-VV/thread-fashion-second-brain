"""Accounts: sign-up, sign-in, email verification, password reset, and account deletion.

Answers never reveal whether an address has an account: sign-up and "forgot password"
reply the same way either way, and the email itself says what happened.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core import security
from app.core.config import Settings
from app.models import AuthToken, Item, User, UserSession
from app.models.enums import TokenPurpose
from app.services.mailer import Mailer
from app.services.rate_limit import RateLimited, limiter
from app.storage import Storage

logger = logging.getLogger(__name__)

VERIFY_TTL = timedelta(hours=24)
RESET_TTL = timedelta(hours=1)
SEEN_EVERY = timedelta(hours=1)  # how often a session's last_seen_at is refreshed


class AuthRefused(Exception):
    """A request the account rules refuse, with its HTTP status and error code."""

    def __init__(
        self, code: str, message: str, status_code: int, retry_after: int | None = None
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.retry_after = retry_after


INVALID_TOKEN = AuthRefused("invalid_token", "This link is invalid or has expired.", 400)


@dataclass(frozen=True)
class Principal:
    """Who is making a request."""

    id: UUID
    is_owner: bool
    email_verified: bool
    session_id: UUID | None = None  # None for the development auto sign-in


def now() -> datetime:
    return datetime.now(UTC)


def normalise_email(email: str) -> str:
    return email.strip().lower()


def to_principal(user: User, session_id: UUID | None = None) -> Principal:
    return Principal(user.id, user.is_owner, user.email_verified_at is not None, session_id)


class AuthService:
    def __init__(
        self, db: Session, settings: Settings, mailer: Mailer, storage: Storage | None = None
    ) -> None:
        self.db = db
        self.settings = settings
        self.mailer = mailer
        self.storage = storage

    # --- lookups -------------------------------------------------------------------------

    def user_by_email(self, email: str) -> User | None:
        return self.db.scalar(select(User).where(func.lower(User.email) == normalise_email(email)))

    def principal_for_token(self, token: str) -> Principal | None:
        """The signed-in user for a session cookie, or None if it is unknown or expired."""
        row = self.db.execute(
            select(UserSession, User)
            .join(User, User.id == UserSession.user_id)
            .where(
                UserSession.token_hash == security.token_hash(token),
                UserSession.expires_at > now(),
                User.disabled_at.is_(None),
            )
        ).one_or_none()
        if row is None:
            return None
        session, user = row
        if session.last_seen_at < now() - SEEN_EVERY:
            session.last_seen_at = now()
            self.db.commit()
        return to_principal(user, session.id)

    # --- sign-up and verification --------------------------------------------------------

    def sign_up(self, email: str, password: str, display_name: str, ip: str) -> None:
        if not self.settings.signup_enabled:
            raise AuthRefused("signup_closed", "Sign-up is closed for now.", 403)
        self._limit(f"signup:{ip}", self.settings.signup_limit_per_hour, 3600)
        existing = self.user_by_email(email)
        if existing is not None:
            if self._email_allowed(existing.email or email):
                self.mailer.send(
                    existing.email or email,
                    "You already have a Thread account",
                    "Someone (hopefully you) tried to create a Thread account with this "
                    "address, which already has one.\n\n"
                    f"Sign in: {self.settings.public_url}/login\n"
                    f"Forgot your password? {self.settings.public_url}/forgot-password\n\n"
                    "If this wasn't you, you can ignore this email.",
                )
            return
        user = User(
            display_name=display_name.strip(),
            email=email.strip(),
            password_hash=security.hash_password(password),
        )
        self.db.add(user)
        self.db.flush()
        if self._email_allowed(user.email or email):
            self._send_verification(user)
        self.db.commit()

    def resend_verification(self, principal: Principal) -> None:
        user = self.db.get_one(User, principal.id)
        if user.email_verified_at is None and user.email and self._email_allowed(user.email):
            self._send_verification(user)
            self.db.commit()

    def verify_email(self, token: str) -> None:
        record = self._use_token(token, TokenPurpose.VERIFY_EMAIL)
        user = self.db.get_one(User, record.user_id)
        user.email_verified_at = user.email_verified_at or now()
        self.db.commit()

    # --- sign-in -------------------------------------------------------------------------

    def sign_in(self, email: str, password: str, ip: str, user_agent: str | None) -> str:
        """Check the password and open a session; returns the new session token."""
        limit = self.settings.login_limit_per_15_minutes
        self._limit(f"login-ip:{ip}", limit, 900)
        self._limit(f"login-email:{normalise_email(email)}", limit, 900)
        user = self.user_by_email(email)
        if not security.verify_password(user.password_hash if user else None, password):
            raise AuthRefused("invalid_credentials", "Email or password is incorrect.", 401)
        assert user is not None and user.password_hash is not None  # noqa: S101
        if user.disabled_at is not None:
            raise AuthRefused("account_disabled", "This account has been disabled.", 403)
        if security.needs_rehash(user.password_hash):
            user.password_hash = security.hash_password(password)
        token = self._open_session(user.id, user_agent)
        self.db.commit()
        return token

    def sign_out(self, token: str) -> None:
        self.db.execute(
            delete(UserSession).where(UserSession.token_hash == security.token_hash(token))
        )
        self.db.commit()

    def sign_out_everywhere(self, principal: Principal) -> None:
        self.db.execute(delete(UserSession).where(UserSession.user_id == principal.id))
        self.db.commit()

    # --- passwords -----------------------------------------------------------------------

    def forgot_password(self, email: str, ip: str) -> None:
        self._limit(f"forgot:{ip}", self.settings.signup_limit_per_hour, 3600)
        user = self.user_by_email(email)
        if user is None or user.disabled_at is not None or not user.email:
            return
        if not self._email_allowed(user.email):
            return
        # Only the newest reset link works.
        self.db.execute(
            update(AuthToken)
            .where(
                AuthToken.user_id == user.id,
                AuthToken.purpose == TokenPurpose.RESET_PASSWORD,
                AuthToken.used_at.is_(None),
            )
            .values(used_at=now())
        )
        token = self._issue_token(user.id, TokenPurpose.RESET_PASSWORD, RESET_TTL)
        self.mailer.send(
            user.email,
            "Reset your Thread password",
            "Choose a new password for your Thread account (the link works for one hour):\n\n"
            f"{self.settings.public_url}/reset-password?token={token}\n\n"
            "If you didn't ask for this, you can ignore this email; your password is unchanged.",
        )
        self.db.commit()

    def reset_password(self, token: str, password: str) -> None:
        record = self._use_token(token, TokenPurpose.RESET_PASSWORD)
        user = self.db.get_one(User, record.user_id)
        if user.disabled_at is not None:
            raise INVALID_TOKEN
        user.password_hash = security.hash_password(password)
        # The link reached their inbox, which is what verification proves.
        user.email_verified_at = user.email_verified_at or now()
        self.db.execute(delete(UserSession).where(UserSession.user_id == user.id))
        self.db.commit()

    def change_password(self, principal: Principal, current: str, new: str) -> None:
        user = self.db.get_one(User, principal.id)
        if user.password_hash is None:
            raise AuthRefused("no_password", "This account has no password yet.", 400)
        if not security.verify_password(user.password_hash, current):
            raise AuthRefused("invalid_credentials", "Your current password is incorrect.", 401)
        user.password_hash = security.hash_password(new)
        # Other devices are signed out; this one stays signed in.
        self.db.execute(
            delete(UserSession).where(
                UserSession.user_id == user.id, UserSession.id != principal.session_id
            )
        )
        self.db.commit()

    # --- deletion and moderation ---------------------------------------------------------

    def delete_account(self, principal: Principal, password: str) -> None:
        """Delete the account, everything it owns, and its image files."""
        user = self.db.get_one(User, principal.id)
        if user.is_owner:
            raise AuthRefused(
                "owner_account",
                "The owner account can't be deleted here; it holds the public showcase.",
                403,
            )
        if not security.verify_password(user.password_hash, password):
            raise AuthRefused("invalid_credentials", "Your password is incorrect.", 401)
        keys = [
            key
            for row in self.db.execute(
                select(Item.original_key, Item.thumbnail_key, Item.cutout_key).where(
                    Item.user_id == user.id
                )
            )
            for key in row
            if key
        ]
        self.db.delete(user)  # cascades to items, collections, sessions and tokens
        self.db.commit()
        if self.storage is not None:
            for key in keys:
                try:
                    self.storage.delete(key)
                except Exception:  # a missing file must not undo a completed deletion
                    logger.exception("Could not remove a stored file of a deleted account")

    def set_disabled(self, user_id: UUID, disabled: bool) -> User:
        user = self.db.get(User, user_id)
        if user is None:
            raise AuthRefused("not_found", "No such account.", 404)
        if user.is_owner:
            raise AuthRefused("owner_account", "The owner account can't be disabled.", 403)
        user.disabled_at = (user.disabled_at or now()) if disabled else None
        if disabled:
            self.db.execute(delete(UserSession).where(UserSession.user_id == user.id))
        self.db.commit()
        return user

    # --- helpers -------------------------------------------------------------------------

    def _limit(self, key: str, limit: int, window: float) -> None:
        try:
            limiter.hit(key, limit, window)
        except RateLimited as exc:
            raise AuthRefused(
                "rate_limited", "Too many attempts. Try again later.", 429, exc.retry_after
            ) from exc

    def _email_allowed(self, email: str) -> bool:
        """At most a few account emails per address per hour, so Thread can't be used to
        flood someone's inbox. Over the limit, the request still answers normally."""
        try:
            self._limit(f"email:{normalise_email(email)}", self.settings.email_limit_per_hour, 3600)
        except AuthRefused:
            return False
        return True

    def _send_verification(self, user: User) -> None:
        assert user.email is not None  # noqa: S101
        token = self._issue_token(user.id, TokenPurpose.VERIFY_EMAIL, VERIFY_TTL)
        self.mailer.send(
            user.email,
            "Confirm your email for Thread",
            f"Welcome to Thread, {user.display_name}.\n\n"
            "Confirm your email address to start adding pieces (the link works for 24 hours):\n\n"
            f"{self.settings.public_url}/verify-email?token={token}\n\n"
            "If you didn't create this account, you can ignore this email.",
        )

    def _issue_token(self, user_id: UUID, purpose: TokenPurpose, ttl: timedelta) -> str:
        token = security.new_token()
        self.db.add(
            AuthToken(
                user_id=user_id,
                purpose=purpose.value,
                token_hash=security.token_hash(token),
                expires_at=now() + ttl,
            )
        )
        return token

    def _use_token(self, token: str, purpose: TokenPurpose) -> AuthToken:
        """Mark a valid, unused, unexpired token as used (atomically) and return it."""
        record = self.db.scalar(
            update(AuthToken)
            .where(
                AuthToken.token_hash == security.token_hash(token),
                AuthToken.purpose == purpose.value,
                AuthToken.used_at.is_(None),
                AuthToken.expires_at > now(),
            )
            .values(used_at=now())
            .returning(AuthToken)
        )
        if record is None:
            raise INVALID_TOKEN
        return record

    def _open_session(self, user_id: UUID, user_agent: str | None) -> str:
        token = security.new_token()
        self.db.add(
            UserSession(
                user_id=user_id,
                token_hash=security.token_hash(token),
                expires_at=now() + timedelta(days=self.settings.session_days),
                user_agent=(user_agent or "")[:200] or None,
            )
        )
        return token
