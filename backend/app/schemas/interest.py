from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator

from app.models.enums import InterestKind, InterestRole
from app.schemas.auth import EmailAddress

OptionalText = Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=120)]
Message = Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=1000)]


class InterestCreate(BaseModel):
    """What a visitor sends from the early access / pilot form."""

    model_config = ConfigDict(extra="forbid")

    kind: InterestKind
    role: InterestRole | None = None
    name: OptionalText = None
    email: EmailAddress
    message: Message = None
    # The visitor ticked "you may contact me about this". Nothing is stored without it.
    consent: Literal[True]
    # A field people never see: anything here came from a bot filling every input.
    website: Annotated[str | None, StringConstraints(max_length=200)] = None

    @model_validator(mode="after")
    def _role_for_studio_only(self) -> "InterestCreate":
        if self.kind == InterestKind.STUDIO and self.role is None:
            raise ValueError("A studio or boutique says what it does.")
        if self.kind == InterestKind.WARDROBE:
            self.role = None
        return self


class InterestReceived(BaseModel):
    """Kept (or quietly ignored, for a bot); the same answer either way."""

    status: Literal["received"] = "received"


class InterestRead(BaseModel):
    id: UUID
    kind: InterestKind
    role: InterestRole | None
    name: str | None
    email: str
    message: str | None
    created_at: datetime
    updated_at: datetime
    contacted_at: datetime | None


class InterestSummary(BaseModel):
    """The owner's view: every registration, and how wardrobe and studio interest compare
    with the accounts that already exist."""

    interest: list[InterestRead]
    wardrobe: int
    studio: int
    studio_by_role: dict[InterestRole, int]
    accounts: int  # accounts other than the owner's
    verified_accounts: int


class InterestUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contacted: bool
