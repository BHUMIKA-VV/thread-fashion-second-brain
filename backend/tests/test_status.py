import pytest

from app.models.enums import ProcessingStatus as S
from app.services.status import derive_status

DONE = "completed"


@pytest.mark.parametrize(
    ("stages", "expected"),
    [
        ({"thumbnail": DONE}, S.QUEUED),
        ({"palette": DONE, "embedding": "pending", "tags": "pending"}, S.QUEUED),
        ({"palette": DONE, "embedding": DONE}, S.QUEUED),  # tags not run yet
        ({"palette": DONE, "embedding": DONE, "tags": DONE}, S.COMPLETED),
        (
            {"palette": DONE, "embedding": "unavailable", "tags": "unavailable"},
            S.PARTIALLY_COMPLETED,
        ),
        ({"palette": "failed", "embedding": DONE, "tags": DONE}, S.PARTIALLY_COMPLETED),
        ({"palette": DONE, "embedding": DONE, "tags": "failed"}, S.PARTIALLY_COMPLETED),
        ({"palette": "failed", "embedding": "failed", "tags": "failed"}, S.FAILED),
        ({"palette": "failed", "embedding": "unavailable", "tags": "unavailable"}, S.FAILED),
    ],
)
def test_overall_status_follows_the_stages(stages: dict[str, str], expected: S) -> None:
    assert derive_status(stages) == expected
