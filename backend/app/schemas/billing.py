from datetime import datetime
from typing import Literal
from uuid import UUID

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


PaidPlanId = Literal["studio", "studio_pro"]


class PeriodRead(BaseModel):
    """One paid period of access: from starts_at up to ends_at."""

    payment_id: UUID
    plan_id: PaidPlanId
    plan_name: str
    starts_at: datetime
    ends_at: datetime
    ended_early: bool = Field(default=False, description="Cancelled before its end (a refund)")
    cancellable: bool = Field(
        default=False, description="Not started yet, so it can be cancelled for a full refund"
    )


class PaymentRead(BaseModel):
    id: UUID
    plan_id: PaidPlanId
    plan_name: str
    amount_paise: int
    currency: Literal["INR"]
    status: Literal["created", "paid", "failed", "refunded"]
    method: str | None
    created_at: datetime
    paid_at: datetime | None
    provider_payment_id: str | None = Field(description="Razorpay's reference for the payment")
    refunded_paise: int
    failure_code: str | None
    refund: Literal["none", "requested", "partial", "full"]
    refreshable: bool = Field(description="Thread can ask Razorpay again what became of it")


class PaymentPage(BaseModel):
    payments: list[PaymentRead] = Field(description="The most recent first")
    next_before: UUID | None = Field(description="Pass as ?before= for the next page")


class CheckoutAvailability(BaseModel):
    available: bool = Field(description="False until payment keys are set on the server")
    provider: Literal["razorpay", "fake"]
    mode: Literal["test"] = Field(description="Test mode: no real money moves")


class BillingAccount(BaseModel):
    """The signed-in account's plan, as of now. Nothing renews by itself."""

    plan_id: Literal["free", "studio", "studio_pro"]
    status: Literal["owner", "free", "active"]
    exempt: bool = Field(description="The owner of this Thread is never charged")
    current: PeriodRead | None
    upcoming: PeriodRead | None = Field(description="A period paid for that starts later")
    last_ended: PeriodRead | None = Field(description="The latest period that is over")
    ending_soon: bool = Field(description="The current period ends within days, none follows")
    next_start_at: datetime = Field(description="When a period bought now would start")
    checkout: CheckoutAvailability


class CancelPeriod(BaseModel):
    # Sent only after the person confirmed: a request without it changes nothing.
    confirm: Literal[True]


class CancelResult(BaseModel):
    refund: Literal["processed", "pending"] = Field(
        description="processed: the money is on its way back; pending: Razorpay is still on it"
    )
    account: BillingAccount


class CheckoutCreate(BaseModel):
    # Only the plan is chosen by the browser: the amount always comes from the catalogue.
    plan_id: PaidPlanId


class CheckoutOrder(BaseModel):
    """What Razorpay Checkout needs to open for this order."""

    payment_id: UUID
    provider: Literal["razorpay", "fake"]
    key_id: str
    order_id: str
    amount_paise: int
    currency: Literal["INR"]
    plan_id: PaidPlanId
    plan_name: str
    description: str
    starts_at: datetime = Field(description="When the period would start if paid now")


class CheckoutVerify(BaseModel):
    order_id: str = Field(pattern=r"^order_[A-Za-z0-9]{1,40}$")
    payment_id: str = Field(pattern=r"^pay_[A-Za-z0-9]{1,40}$")
    signature: str = Field(pattern=r"^[0-9a-f]{64}$")


class CheckoutResult(BaseModel):
    status: Literal["paid", "pending", "failed"] = Field(
        description="paid: access is granted; pending: Razorpay hasn't captured it yet"
    )
    period: PeriodRead | None
    failure_code: str | None = None


class FakePay(BaseModel):
    order_id: str = Field(pattern=r"^order_[A-Za-z0-9]{1,40}$")
    outcome: Literal["captured", "authorized", "failed"]
