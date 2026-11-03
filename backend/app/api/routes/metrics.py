"""Anonymous visit counts: a beacon for public pages (/metrics/view) and the owner's summary
(/admin/metrics). See app/services/metrics.py for what is and isn't kept."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.api.deps import ClientIp, Owner
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.schemas.metrics import MetricsSummary, ViewCreate
from app.services.metrics import MetricsService

router = APIRouter(tags=["metrics"])


def get_metrics_service(
    db: Annotated[Session, Depends(get_db)], settings: Annotated[Settings, Depends(get_settings)]
) -> MetricsService:
    return MetricsService(db, settings.public_url)


Metrics = Annotated[MetricsService, Depends(get_metrics_service)]


@router.post("/metrics/view", status_code=status.HTTP_204_NO_CONTENT)
def count_view(body: ViewCreate, request: Request, metrics: Metrics, ip: ClientIp) -> Response:
    """Count one visit seeing a public page. Always 204, counted or not, so the answer says
    nothing about rate limits or opt-outs."""
    headers = request.headers
    opted_out = headers.get("sec-gpc") == "1" or headers.get("dnt") == "1"
    metrics.count_view(body, ip, headers.get("user-agent"), opted_out)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/admin/metrics", response_model=MetricsSummary)
def metrics_summary(
    _: Owner, metrics: Metrics, days: Annotated[int, Query(ge=1, le=365)] = 30
) -> MetricsSummary:
    return metrics.summary(days)
