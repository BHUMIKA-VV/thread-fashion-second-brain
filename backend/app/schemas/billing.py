from typing import Literal

from pydantic import BaseModel, Field


class FeatureRead(BaseModel):
    key: str
    label: str
    detail: str


class PlanRead(BaseModel):
    id: str
    name: str
    summary: str
    price_paise: int = Field(description="Whole paise; 99900 is Rs 999")
    currency: Literal["INR"]
    period_days: int | None = Field(description="Days one payment covers; null for Free")
    max_pieces: int
    max_bytes: int | None = Field(description="Storage for photographs; null if not set")
    features: list[str] = Field(description="Keys into the catalogue's features, in order")


class PlanCatalogue(BaseModel):
    """The plans as the pricing page shows them."""

    status: Literal["proposed"] = Field(
        description="Proposed pilot pricing, not validated market prices"
    )
    on_sale: bool = Field(description="Whether a plan can be bought; false until checkout opens")
    features: list[FeatureRead]
    plans: list[PlanRead]
