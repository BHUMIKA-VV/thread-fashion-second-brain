"""The owner's billing views (M14-7). Read-only apart from asking Razorpay about a payment."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.auth import AccountRead
from app.schemas.billing import BillingAccount


class AccountsByPlan(BaseModel):
    """Accounts other than the owner's, by the plan they are on right now."""

    free: int
    studio: int
    studio_pro: int


class PaymentsByStatus(BaseModel):
    unfinished: int = Field(description="Orders opened that Razorpay hasn't confirmed")
    paid: int
    failed: int
    refunded: int = Field(description="Refunded in full")
    refund_requested: int = Field(description="Cancelled for a refund Razorpay hasn't finished")


class BillingTotals(BaseModel):
    """From verified payments only, in paise. Test mode: no real money."""

    paid_paise: int
    refunded_paise: int
    net_paise: int


class BillingSummary(BaseModel):
    accounts: AccountsByPlan
    paid_ahead: int = Field(description="Periods paid for that haven't started")
    ended: int = Field(description="Accounts that had a period and are back on Free")
    cancelled_refund: int = Field(description="Periods cancelled for a refund")
    cancelled_owner: int = Field(description="Periods cancelled by the owner")
    payments: PaymentsByStatus
    totals: BillingTotals
    mode: Literal["test"]
    provider: Literal["razorpay", "fake"]


class LookupResult(BaseModel):
    account_id: UUID


class AdminAccountBilling(BaseModel):
    account: AccountRead
    billing: BillingAccount


class AdminActionRead(BaseModel):
    id: UUID
    created_at: datetime
    action: Literal["billing_lookup", "payment_check", "account_disable", "account_enable"]
    account_id: UUID | None
    account_name: str | None = Field(description="The account's display name, if it still exists")
    payment_id: UUID | None
    outcome: str
