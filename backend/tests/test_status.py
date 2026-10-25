import pytest

from app.models.enums import ProcessingStatus as S
from app.services.status import derive_status


@pytest.mark.parametrize(
    ("stages", "expected"),
    [
        ({"thumbnail": "completed"}, S.QUEUED),
        ({"palette": "completed", "embedding": "pending"}, S.QUEUED),
        ({"palette": "completed", "embedding": "completed"}, S.COMPLETED),
        ({"palette": "completed", "embedding": "unavailable"}, S.PARTIALLY_COMPLETED),
        ({"palette": "failed", "embedding": "completed"}, S.PARTIALLY_COMPLETED),
        ({"palette": "failed", "embedding": "failed"}, S.FAILED),
        ({"palette": "failed", "embedding": "unavailable"}, S.FAILED),
    ],
)
def test_overall_status_follows_the_stages(stages: dict[str, str], expected: S) -> None:
    assert derive_status(stages) == expected
