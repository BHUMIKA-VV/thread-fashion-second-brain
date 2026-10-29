from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, StringConstraints

from app.core.security import PASSWORD_MAX, PASSWORD_MIN

# A deliberately loose check: one @, something on each side, a dot in the domain. Whether
# an address really works is what the verification email finds out.
EmailAddress = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"),
]
Password = Annotated[str, StringConstraints(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)]
# Sign-in accepts any length so a short (old or mistyped) password gets the usual answer.
AnyPassword = Annotated[str, StringConstraints(min_length=1, max_length=PASSWORD_MAX)]
DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Token = Annotated[str, StringConstraints(min_length=10, max_length=200)]


class SignUp(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailAddress
    password: Password
    display_name: DisplayName


class SignIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailAddress
    password: AnyPassword


class EmailOnly(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailAddress


class TokenOnly(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: Token


class ResetPassword(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: Token
    password: Password


class ChangePassword(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: AnyPassword
    new_password: Password


class ConfirmPassword(BaseModel):
    model_config = ConfigDict(extra="forbid")

    password: AnyPassword


class Accepted(BaseModel):
    """The request was taken; what happens next is in an email (if anything)."""

    status: str = "check_email"


class Me(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    display_name: str
    email: str | None
    email_verified: bool
    is_owner: bool
    has_password: bool


class AccountRead(BaseModel):
    """The owner's view of an account (moderation)."""

    id: UUID
    display_name: str
    email: str | None
    created_at: datetime
    email_verified: bool
    disabled: bool
    is_owner: bool
    items: int


class OutboxEmail(BaseModel):
    to: str
    subject: str
    text: str
    sent_at: datetime
