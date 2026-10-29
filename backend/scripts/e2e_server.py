"""Start the API for end-to-end tests, on a fresh database of its own.

  python -m scripts.e2e_server --port 8011

Used by frontend/playwright.config.ts; you never need to run it by hand. Every run:

- drops and recreates the database `thread_e2e` (next to THREAD_TEST_DATABASE_URL's
  maintenance database) and migrates it, so browser tests never touch your archive;
- empties .cache/e2e-storage/ and stores test images there, not in storage/;
- creates the owner account e2e-owner@thread.test with THREAD_E2E_OWNER_PASSWORD;
- turns off the local auto sign-in and lifts the sign-up rate limits (every test signs up
  its own account), keeps emails in the local outbox, and uses the fake deep analyzer.

Refuses to run unless THREAD_TEST_DATABASE_URL is set, and never in production.
"""

import argparse
import os
import shutil
import sys
from pathlib import Path

E2E_DATABASE = "thread_e2e"
OWNER_EMAIL = "e2e-owner@thread.test"
REPO_ROOT = Path(__file__).resolve().parents[2]
STORAGE = REPO_ROOT / ".cache" / "e2e-storage"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8011)
    args = parser.parse_args(argv)

    from app.core.config import get_settings

    base = get_settings()
    if base.app_env == "production":
        print("Refusing to run end-to-end setup in production.", file=sys.stderr)
        return 1
    if not base.test_database_url:
        print("THREAD_TEST_DATABASE_URL is not set (see .env.example).", file=sys.stderr)
        return 1
    owner_password = os.environ.get("THREAD_E2E_OWNER_PASSWORD", "")
    if len(owner_password) < 12:
        print("THREAD_E2E_OWNER_PASSWORD (12+ characters) is required.", file=sys.stderr)
        return 1

    from sqlalchemy import create_engine, make_url, text

    maintenance = base.test_database_url
    url = make_url(maintenance).set(database=E2E_DATABASE).render_as_string(hide_password=False)
    admin = create_engine(maintenance, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{E2E_DATABASE}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{E2E_DATABASE}"'))
    admin.dispose()

    from app.db import migrations

    migrations.upgrade(url)
    shutil.rmtree(STORAGE, ignore_errors=True)
    STORAGE.mkdir(parents=True)

    # The environment wins over .env, and these settings are read once, when the app starts.
    os.environ.update(
        {
            "THREAD_DATABASE_URL": url,
            "THREAD_STORAGE_DIR": str(STORAGE),
            "THREAD_APP_ENV": "development",
            "THREAD_DEV_AUTO_SIGNIN": "false",
            "THREAD_MAIL_PROVIDER": "log",
            "THREAD_RESEND_API_KEY": "",
            "THREAD_DEEP_ANALYSIS_PROVIDER": "fake",
            "THREAD_ANTHROPIC_API_KEY": "",
            "THREAD_SIGNUP_LIMIT_PER_HOUR": "100000",
            "THREAD_LOGIN_LIMIT_PER_15_MINUTES": "100000",
            "THREAD_EMAIL_LIMIT_PER_HOUR": "100000",
        }
    )
    get_settings.cache_clear()

    from datetime import UTC, datetime

    from sqlalchemy.orm import Session

    from app.core import security
    from app.models import User

    engine = create_engine(url)
    with Session(engine) as db, db.begin():
        db.add(
            User(
                display_name="E2E Owner",
                email=OWNER_EMAIL,
                password_hash=security.hash_password(owner_password),
                email_verified_at=datetime.now(UTC),
                is_owner=True,
            )
        )
    engine.dispose()

    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
