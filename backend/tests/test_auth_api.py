"""Accounts: sign-up, verification, sign-in, sessions, password reset, deletion, quotas,
moderation, and the isolation between accounts that public sign-up depends on."""

import logging
import re
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_optional_user, get_storage
from app.api.routes.deep_analysis import get_deep_analyzer
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.main import app
from app.ml.deep_analyzer import FakeDeepAnalyzer
from app.models import AuthToken, Item, User, UserSession
from app.services.auth import AuthService
from app.services.mailer import OUTBOX, LogMailer
from app.storage import LocalStorage
from tests.images import image_bytes

pytestmark = pytest.mark.db

PASSWORD = "correct horse battery"  # noqa: S105 (a test password)
TOKEN = re.compile(r"token=([\w-]+)")


@pytest.fixture
def web(db: Session, storage: LocalStorage, settings: Settings) -> Iterator[TestClient]:
    """The API with real sign-in (nothing overridden but the database, storage and settings)."""
    app.dependency_overrides.update(
        {get_db: lambda: db, get_storage: lambda: storage, get_settings: lambda: settings}
    )
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client
    app.dependency_overrides.clear()


def browser() -> TestClient:
    """Another browser with its own cookie jar, sharing the `web` fixture's overrides."""
    return TestClient(app, raise_server_exceptions=False)


def emails_to(address: str) -> list[str]:
    return [m.text for m in OUTBOX if m.to.lower() == address.lower()]


def link_token(address: str) -> str:
    match = TOKEN.search(emails_to(address)[-1])
    assert match, "no link in the email"
    return match.group(1)


def sign_up(client: TestClient, email: str, password: str = PASSWORD, name: str = "Ada"):  # noqa: ANN201
    return client.post(
        "/auth/signup", json={"email": email, "password": password, "display_name": name}
    )


def sign_in(client: TestClient, email: str, password: str = PASSWORD):  # noqa: ANN201
    return client.post("/auth/login", json={"email": email, "password": password})


def account(client: TestClient, email: str, *, verified: bool = True) -> TestClient:
    """Sign up, optionally verify, and sign in on `client`."""
    assert sign_up(client, email).status_code == 202
    if verified:
        assert (
            client.post("/auth/verify-email", json={"token": link_token(email)}).status_code == 204
        )
    assert sign_in(client, email).status_code == 200
    return client


def upload(client: TestClient, seed: int | None = None):  # noqa: ANN201
    data = image_bytes(seed=seed)
    return client.post(
        "/items", files={"file": ("p.jpg", data, "image/jpeg")}, data={"type": "garment"}
    )


def make_owner(db: Session, email: str) -> None:
    db.execute(update(User).where(func.lower(User.email) == email).values(is_owner=True))
    db.flush()


# --- sign-up and verification ------------------------------------------------------------


def test_sign_up_emails_a_link_and_upload_waits_for_verification(web: TestClient) -> None:
    response = sign_up(web, "ada@example.com")
    assert response.status_code == 202
    assert response.json() == {"status": "check_email"}
    assert "set-cookie" not in response.headers  # not signed in by signing up
    assert "/verify-email?token=" in emails_to("ada@example.com")[-1]

    assert sign_in(web, "ada@example.com").status_code == 200  # unverified may sign in
    me = web.get("/auth/me").json()
    assert (me["email"], me["email_verified"], me["is_owner"]) == ("ada@example.com", False, False)
    refused = upload(web)
    assert refused.status_code == 403
    assert refused.json()["error"]["code"] == "email_not_verified"

    assert (
        web.post("/auth/verify-email", json={"token": link_token("ada@example.com")}).status_code
        == 204
    )
    assert web.get("/auth/me").json()["email_verified"] is True
    assert upload(web).status_code == 201


def test_a_verification_link_works_once(web: TestClient) -> None:
    sign_up(web, "ada@example.com")
    token = link_token("ada@example.com")
    assert web.post("/auth/verify-email", json={"token": token}).status_code == 204
    again = web.post("/auth/verify-email", json={"token": token})
    assert again.status_code == 400
    assert again.json()["error"]["code"] == "invalid_token"


def test_signing_up_again_reveals_nothing_and_tells_the_owner(web: TestClient, db: Session) -> None:
    sign_up(web, "ada@example.com")
    second = sign_up(web, "ADA@Example.com", password="a different password", name="Mallory")  # noqa: S106

    assert second.status_code == 202
    assert second.json() == {"status": "check_email"}
    assert db.scalar(select(func.count()).select_from(User).where(User.email.is_not(None))) == 1
    assert "already has one" in emails_to("ada@example.com")[-1]
    assert sign_in(web, "ada@example.com", "a different password").status_code == 401


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"email": "ada@example.com", "password": "short", "display_name": "Ada"}, "password"),
        ({"email": "not-an-email", "password": PASSWORD, "display_name": "Ada"}, "email"),
        ({"email": "ada@example.com", "password": PASSWORD, "display_name": "  "}, "display_name"),
        ({"email": "a@b.co", "password": "x" * 129, "display_name": "Ada"}, "password"),
    ],
)
def test_sign_up_validates_its_fields(web: TestClient, body: dict[str, str], field: str) -> None:
    response = web.post("/auth/signup", json=body)
    assert response.status_code == 422
    assert field in str(response.json()["error"]["details"])


def test_passwords_are_stored_as_argon2id_hashes(web: TestClient, db: Session) -> None:
    sign_up(web, "ada@example.com")
    stored = db.scalar(select(User.password_hash).where(User.email == "ada@example.com"))
    assert stored is not None and stored.startswith("$argon2id$")
    assert PASSWORD not in stored


def test_sign_up_can_be_closed(web: TestClient, settings: Settings) -> None:
    app.dependency_overrides[get_settings] = lambda: settings.model_copy(
        update={"signup_enabled": False}
    )
    response = sign_up(web, "ada@example.com")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "signup_closed"


def test_resend_verification(web: TestClient) -> None:
    account(web, "ada@example.com", verified=False)
    assert web.post("/auth/resend-verification").status_code == 202
    assert len(emails_to("ada@example.com")) == 2


# --- sign-in and sessions ----------------------------------------------------------------


def test_sign_in_sets_a_locked_down_cookie_and_stores_only_its_hash(
    web: TestClient, db: Session
) -> None:
    sign_up(web, "ada@example.com")
    response = sign_in(web, "ada@example.com")

    assert response.status_code == 200
    cookie = response.headers["set-cookie"]
    assert "thread_session=" in cookie
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie and "Path=/" in cookie
    token = response.cookies["thread_session"]
    stored = db.scalars(select(UserSession.token_hash)).all()
    assert len(stored) == 1 and token.encode() not in stored[0]


def test_wrong_password_and_unknown_email_get_the_same_answer(web: TestClient) -> None:
    sign_up(web, "ada@example.com")
    wrong = sign_in(web, "ada@example.com", "wrong password!!")
    unknown = sign_in(web, "nobody@example.com")

    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()
    assert wrong.json()["error"]["code"] == "invalid_credentials"


def test_signed_out_requests_are_refused(web: TestClient) -> None:
    for method, path in [("GET", "/items"), ("GET", "/collections"), ("GET", "/auth/me")]:
        response = web.request(method, path)
        assert response.status_code == 401, path
        assert response.json()["error"]["code"] == "not_signed_in"
    assert web.get("/auth/session").json() is None
    assert upload(web).status_code == 401


def test_sign_out_ends_the_session_for_good(web: TestClient) -> None:
    account(web, "ada@example.com")
    token = web.cookies["thread_session"]

    assert web.post("/auth/logout").status_code == 204
    replay = browser()
    replay.cookies.set("thread_session", token)
    assert replay.get("/auth/me").status_code == 401


def test_sign_out_everywhere(web: TestClient) -> None:
    account(web, "ada@example.com")
    laptop = browser()
    assert sign_in(laptop, "ada@example.com").status_code == 200

    assert web.post("/auth/logout-everywhere").status_code == 204
    assert laptop.get("/auth/me").status_code == 401


def test_an_expired_session_is_signed_out(web: TestClient, db: Session) -> None:
    account(web, "ada@example.com")
    db.execute(update(UserSession).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    assert web.get("/auth/me").status_code == 401


def test_sign_in_is_rate_limited_per_address(web: TestClient, settings: Settings) -> None:
    app.dependency_overrides[get_settings] = lambda: settings.model_copy(
        update={"login_limit_per_15_minutes": 3}
    )
    sign_up(web, "ada@example.com")
    for _ in range(3):
        assert sign_in(web, "ada@example.com", "wrong password!!").status_code == 401
    limited = sign_in(web, "ada@example.com")  # even the right password waits
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "rate_limited"
    assert int(limited.headers["retry-after"]) > 0


def test_sign_up_is_rate_limited_per_ip(web: TestClient, settings: Settings) -> None:
    app.dependency_overrides[get_settings] = lambda: settings.model_copy(
        update={"signup_limit_per_hour": 2}
    )
    assert sign_up(web, "a@example.com").status_code == 202
    assert sign_up(web, "b@example.com").status_code == 202
    assert sign_up(web, "c@example.com").status_code == 429


def test_account_emails_per_address_are_capped(web: TestClient) -> None:
    sign_up(web, "ada@example.com")  # 1 verification email
    for _ in range(5):
        assert (
            web.post("/auth/forgot-password", json={"email": "ada@example.com"}).status_code == 202
        )
    assert len(emails_to("ada@example.com")) == 3  # THREAD_EMAIL_LIMIT_PER_HOUR default


# --- passwords -----------------------------------------------------------------------------


def test_password_reset_replaces_the_password_and_signs_out_everywhere(web: TestClient) -> None:
    account(web, "ada@example.com")
    other = browser()
    assert other.post("/auth/forgot-password", json={"email": "ada@example.com"}).status_code == 202
    token = link_token("ada@example.com")
    assert "/reset-password?token=" in emails_to("ada@example.com")[-1]

    new = "a brand new passphrase"
    assert (
        other.post("/auth/reset-password", json={"token": token, "password": new}).status_code
        == 204
    )
    assert web.get("/auth/me").status_code == 401  # the old session is gone
    assert sign_in(other, "ada@example.com").status_code == 401
    assert sign_in(other, "ada@example.com", new).status_code == 200
    reuse = other.post("/auth/reset-password", json={"token": token, "password": PASSWORD})
    assert reuse.status_code == 400


def test_forgot_password_for_an_unknown_address_looks_the_same(web: TestClient) -> None:
    response = web.post("/auth/forgot-password", json={"email": "nobody@example.com"})
    assert response.status_code == 202
    assert response.json() == {"status": "check_email"}
    assert emails_to("nobody@example.com") == []


def test_only_the_newest_reset_link_works(web: TestClient) -> None:
    sign_up(web, "ada@example.com")
    web.post("/auth/forgot-password", json={"email": "ada@example.com"})
    first = link_token("ada@example.com")
    web.post("/auth/forgot-password", json={"email": "ada@example.com"})
    second = link_token("ada@example.com")

    body = {"password": "a brand new passphrase"}
    assert web.post("/auth/reset-password", json={"token": first, **body}).status_code == 400
    assert web.post("/auth/reset-password", json={"token": second, **body}).status_code == 204


def test_an_expired_reset_link_is_refused(web: TestClient, db: Session) -> None:
    sign_up(web, "ada@example.com")
    web.post("/auth/forgot-password", json={"email": "ada@example.com"})
    db.execute(update(AuthToken).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    response = web.post(
        "/auth/reset-password",
        json={"token": link_token("ada@example.com"), "password": "a brand new passphrase"},
    )
    assert response.status_code == 400


def test_change_password_keeps_this_session_and_ends_the_others(web: TestClient) -> None:
    account(web, "ada@example.com")
    phone = browser()
    sign_in(phone, "ada@example.com")

    wrong = web.post(
        "/auth/change-password",
        json={"current_password": "not it at all", "new_password": "a brand new passphrase"},
    )
    assert wrong.status_code == 401
    ok = web.post(
        "/auth/change-password",
        json={"current_password": PASSWORD, "new_password": "a brand new passphrase"},
    )
    assert ok.status_code == 204
    assert web.get("/auth/me").status_code == 200
    assert phone.get("/auth/me").status_code == 401


# --- isolation between accounts ------------------------------------------------------------


def test_accounts_cannot_see_or_touch_each_others_pieces(web: TestClient) -> None:
    alice = account(web, "alice@example.com")
    piece = upload(alice, seed=1).json()["id"]
    collection = alice.post("/collections", json={"name": "Mine"}).json()["id"]
    bob = account(browser(), "bob@example.com")

    for path in (
        f"/items/{piece}",
        f"/items/{piece}/image",
        f"/items/{piece}/image?variant=original",
        f"/items/{piece}/similar",
        f"/items/{piece}/tags",
        f"/collections/{collection}",
    ):
        assert bob.get(path).status_code == 404, path
    assert bob.get("/items").json()["total"] == 0
    assert bob.get("/items", params={"q": "garment"}).json()["total"] == 0
    assert bob.get("/items/summary").json()["total"] == 0
    assert bob.patch(f"/items/{piece}", json={"notes": "mine now"}).status_code == 404
    assert bob.delete(f"/items/{piece}").status_code == 404
    assert bob.delete(f"/collections/{collection}").status_code == 404
    own = bob.post("/collections", json={"name": "Mine"}).json()["id"]  # same name is fine
    assert bob.post(f"/collections/{own}/items", json={"item_id": piece}).status_code == 404

    assert alice.get(f"/items/{piece}").status_code == 200
    assert alice.get(f"/collections/{collection}").status_code == 200


def test_the_same_photo_can_be_in_two_archives(web: TestClient) -> None:
    alice = account(web, "alice@example.com")
    bob = account(browser(), "bob@example.com")
    data = image_bytes(seed=7)
    files = {"file": ("p.jpg", data, "image/jpeg")}
    assert alice.post("/items", files=files).status_code == 201
    assert bob.post("/items", files=files).status_code == 201


# --- quotas, Deep Analyze and moderation ---------------------------------------------------


def test_accounts_have_a_piece_quota_the_owner_does_not(
    web: TestClient, db: Session, settings: Settings
) -> None:
    app.dependency_overrides[get_settings] = lambda: settings.model_copy(update={"quota_items": 1})
    alice = account(web, "alice@example.com")
    assert upload(alice, seed=1).status_code == 201
    full = upload(alice, seed=2)
    assert full.status_code == 403
    assert full.json()["error"]["code"] == "quota_exceeded"

    make_owner(db, "alice@example.com")
    assert upload(alice, seed=3).status_code == 201


def test_accounts_have_a_storage_quota(web: TestClient, settings: Settings) -> None:
    app.dependency_overrides[get_settings] = lambda: settings.model_copy(
        update={"quota_bytes": 1000}
    )
    alice = account(web, "alice@example.com")
    full = upload(alice)
    assert full.status_code == 403
    assert "storage limit" in full.json()["error"]["message"]


def test_only_the_owner_can_run_deep_analysis(web: TestClient, db: Session) -> None:
    app.dependency_overrides[get_deep_analyzer] = lambda: FakeDeepAnalyzer()
    alice = account(web, "alice@example.com")
    piece = upload(alice).json()["id"]

    refused = alice.post(f"/items/{piece}/deep-analyze", json={"confirm": True})
    assert refused.status_code == 403
    assert refused.json()["error"]["code"] == "owner_only"
    assert alice.get(f"/items/{piece}/deep-analysis").status_code == 200  # reading is fine


def test_the_owner_can_disable_an_account(web: TestClient, db: Session) -> None:
    owner = account(web, "owner@example.com")
    make_owner(db, "owner@example.com")
    bob = account(browser(), "bob@example.com")
    upload(bob)
    bob_id = bob.get("/auth/me").json()["id"]

    assert bob.get("/admin/accounts").status_code == 403
    listed = {a["email"]: a for a in owner.get("/admin/accounts").json()}
    assert listed["bob@example.com"]["items"] == 1

    disabled = owner.post(f"/admin/accounts/{bob_id}/disable")
    assert disabled.status_code == 200 and disabled.json()["disabled"] is True
    assert bob.get("/auth/me").status_code == 401
    blocked = sign_in(browser(), "bob@example.com")
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "account_disabled"

    assert owner.post(f"/admin/accounts/{bob_id}/enable").status_code == 200
    assert sign_in(browser(), "bob@example.com").status_code == 200
    owner_id = owner.get("/auth/me").json()["id"]
    assert owner.post(f"/admin/accounts/{owner_id}/disable").status_code == 403


# --- account deletion ----------------------------------------------------------------------


def test_deleting_an_account_removes_its_data_and_files(
    web: TestClient, db: Session, storage: LocalStorage
) -> None:
    alice = account(web, "alice@example.com")
    piece = upload(alice).json()["id"]
    alice.post("/collections", json={"name": "Gone soon"})
    keys = db.execute(select(Item.original_key, Item.thumbnail_key)).one()
    assert all(storage.exists(k) for k in keys)

    wrong = alice.post("/auth/delete-account", json={"password": "not my password"})
    assert wrong.status_code == 401
    assert alice.post("/auth/delete-account", json={"password": PASSWORD}).status_code == 204

    assert db.scalar(select(func.count()).select_from(Item).where(Item.id == piece)) == 0
    assert db.scalar(select(func.count()).select_from(User).where(User.email.is_not(None))) == 0
    assert not any(storage.exists(k) for k in keys)
    assert sign_in(browser(), "alice@example.com").status_code == 401


def test_the_owner_account_cannot_be_deleted_from_the_app(web: TestClient, db: Session) -> None:
    owner = account(web, "owner@example.com")
    make_owner(db, "owner@example.com")
    response = owner.post("/auth/delete-account", json={"password": PASSWORD})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "owner_account"


# --- cross-site requests -------------------------------------------------------------------


def test_writes_from_another_site_are_refused(web: TestClient) -> None:
    account(web, "ada@example.com")
    evil = web.post("/collections", json={"name": "x"}, headers={"Origin": "https://evil.example"})
    assert evil.status_code == 403
    assert evil.json()["error"]["code"] == "bad_origin"
    sneaky = web.post("/collections", json={"name": "y"}, headers={"Sec-Fetch-Site": "cross-site"})
    assert sneaky.status_code == 403
    ours = web.post("/collections", json={"name": "z"}, headers={"Origin": "http://127.0.0.1:3100"})
    assert ours.status_code == 201
    assert web.get("/collections", headers={"Origin": "https://evil.example"}).status_code == 200


# --- development auto sign-in, settings and IPs --------------------------------------------


def _optional_user(db: Session, settings: Settings) -> object:
    from starlette.requests import Request

    request = Request({"type": "http", "headers": [], "method": "GET", "path": "/"})
    return get_optional_user(request, AuthService(db, settings, LogMailer()))


def test_auto_sign_in_is_for_local_development_only(db: Session, settings: Settings) -> None:
    db.add(User(id=settings.dev_user_id, display_name="Local developer"))
    db.flush()

    dev = settings.model_copy(update={"app_env": "development", "dev_auto_signin": True})
    principal = _optional_user(db, dev)
    assert principal is not None and principal.id == settings.dev_user_id  # type: ignore[attr-defined]

    off = dev.model_copy(update={"dev_auto_signin": False})
    assert _optional_user(db, off) is None
    for env in ("test", "production"):
        assert _optional_user(db, dev.model_copy(update={"app_env": env})) is None


def test_production_refuses_unsafe_account_settings() -> None:
    base = {"_env_file": None, "database_url": "postgresql+psycopg://unused/db"}
    with pytest.raises(ValueError, match="THREAD_COOKIE_SECURE") as excinfo:
        Settings(**base, app_env="production")  # type: ignore[arg-type]
    for setting in ("THREAD_PUBLIC_URL", "THREAD_MAIL_PROVIDER", "THREAD_ALLOWED_ORIGINS"):
        assert setting in str(excinfo.value)

    Settings(  # type: ignore[arg-type]
        **base,
        app_env="production",
        cookie_secure=True,
        public_url="https://thread.example",
        allowed_origins="https://thread.example",
        mail_provider="resend",
        resend_api_key="re_test_key",
    )


@pytest.mark.parametrize(
    ("hops", "forwarded", "expected"),
    [
        (0, "1.1.1.1, 2.2.2.2", "testclient"),
        (1, "1.1.1.1, 2.2.2.2", "2.2.2.2"),
        (2, "forged, 1.1.1.1, 2.2.2.2", "1.1.1.1"),
        (3, "1.1.1.1", "testclient"),  # fewer hops than expected: fall back to the socket
    ],
)
def test_client_ip_only_trusts_your_own_proxies(
    settings: Settings, hops: int, forwarded: str, expected: str
) -> None:
    from starlette.requests import Request

    request = Request(
        {
            "type": "http",
            "headers": [(b"x-forwarded-for", forwarded.encode())],
            "client": ("testclient", 1),
        }
    )
    assert client_ip(request, settings.model_copy(update={"forwarded_hops": hops})) == expected


def test_emails_and_their_links_stay_out_of_the_log(
    web: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.DEBUG):
        sign_up(web, "ada@example.com")
    token = link_token("ada@example.com")
    assert token not in caplog.text
    assert "ada@example.com" not in caplog.text


def test_the_dev_outbox_shows_local_emails(web: TestClient) -> None:
    sign_up(web, "ada@example.com")
    mails = web.get("/dev/outbox", params={"to": "ADA@example.com"}).json()
    assert len(mails) == 1 and "verify-email" in mails[0]["text"]


def test_the_dev_outbox_is_not_mounted_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    import app.main as main

    production = Settings(  # type: ignore[call-arg]
        _env_file=None,
        database_url="postgresql+psycopg://unused/db",
        app_env="production",
        cookie_secure=True,
        public_url="https://thread.example",
        allowed_origins="https://thread.example",
        mail_provider="resend",
        resend_api_key="re_test_key",
    )
    monkeypatch.setattr(main, "get_settings", lambda: production)
    paths = main.create_app().openapi()["paths"]
    assert "/dev/outbox" not in paths
    assert "/auth/login" in paths


def test_tmp_storage_root_is_used(storage: LocalStorage, tmp_path: Path) -> None:
    """Guard: these tests write image files only under pytest's temporary folder."""
    assert str(storage._path("users/x/items/y/original.jpg")).startswith(str(tmp_path))


# --- claiming the owner account ------------------------------------------------------------


def test_claim_owner_keeps_the_archive_and_signs_in(
    migrated_db_url: str, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    import uuid

    from sqlalchemy import create_engine, delete
    from sqlalchemy.orm import sessionmaker

    from scripts import claim_owner
    from tests.conftest import item_fields

    engine = create_engine(migrated_db_url)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    dev_id = uuid.uuid4()
    local = settings.model_copy(update={"dev_user_id": dev_id})
    monkeypatch.setattr(claim_owner, "get_settings", lambda: local)
    monkeypatch.setattr(claim_owner, "get_session_factory", lambda: factory)
    monkeypatch.setattr(claim_owner.getpass, "getpass", lambda _prompt: PASSWORD)
    with factory() as db, db.begin():
        db.add(User(id=dev_id, display_name="Local developer"))
        db.flush()
        db.add(Item(user_id=dev_id, **item_fields()))
    try:
        assert claim_owner.main(["--email", "Me@Example.com", "--name", "Bhumika"]) == 0
        with factory() as db:
            user = db.get_one(User, dev_id)
            assert (user.email, user.is_owner, user.display_name) == (
                "Me@Example.com",
                True,
                "Bhumika",
            )
            assert user.email_verified_at is not None
            assert security_verify(user.password_hash, PASSWORD)
            assert db.scalar(select(func.count()).where(Item.user_id == dev_id)) == 1
        # A second owner is refused.
        with factory() as db, db.begin():
            other = User(display_name="Other", email="o@example.com")
            db.add(other)
        assert claim_owner.main(["--email", "o@example.com", "--user-id", str(other.id)]) == 1
    finally:
        with factory() as db, db.begin():
            db.execute(delete(User).where(User.id.in_([dev_id, other.id])))
        engine.dispose()


def security_verify(password_hash: str | None, password: str) -> bool:
    from app.core import security

    return security.verify_password(password_hash, password)
