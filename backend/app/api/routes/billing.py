"""Plans and pricing (/billing). Public and read-only for now: nothing can be bought yet."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response

from app.billing.plans import CURRENCY, FEATURES, plans
from app.core.config import Settings, get_settings
from app.schemas.billing import FeatureRead, PlanCatalogue, PlanRead

router = APIRouter(prefix="/billing", tags=["billing"])


@router.get("/plans", response_model=PlanCatalogue)
def list_plans(
    response: Response, settings: Annotated[Settings, Depends(get_settings)]
) -> PlanCatalogue:
    """The plans, cheapest first, with server-defined prices in paise. No sign-in needed."""
    response.headers["Cache-Control"] = "public, max-age=300"
    return PlanCatalogue(
        status="proposed",
        on_sale=False,
        features=[FeatureRead(key=f.key, label=f.label, detail=f.detail) for f in FEATURES],
        plans=[
            PlanRead(
                id=p.id,
                name=p.name,
                summary=p.summary,
                price_paise=p.price_paise,
                currency=CURRENCY,
                period_days=p.period_days,
                max_pieces=p.max_pieces,
                max_bytes=p.max_bytes,
                features=list(p.features),
            )
            for p in plans(settings)
        ],
    )
