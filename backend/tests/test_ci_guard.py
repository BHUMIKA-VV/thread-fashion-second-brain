"""The test database guard: skipped locally, required in CI."""

import pytest

from tests.conftest import database_unavailable


def test_without_the_ci_flag_a_missing_test_database_skips(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("THREAD_REQUIRE_TEST_DB", raising=False)
    with pytest.raises(pytest.skip.Exception, match="not reachable"):
        database_unavailable("Test database is not reachable")


def test_with_the_ci_flag_a_missing_test_database_fails_the_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("THREAD_REQUIRE_TEST_DB", "1")
    with pytest.raises(pytest.fail.Exception, match="the test database is required"):
        database_unavailable("Test database is not reachable")


def test_any_other_value_of_the_ci_flag_still_skips(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("THREAD_REQUIRE_TEST_DB", "yes")
    with pytest.raises(pytest.skip.Exception):
        database_unavailable("Test database is not reachable")
