"""Make an account the owner of this Thread: the person whose archive is the public showcase.

  python -m scripts.claim_owner --email you@example.com

With no --user-id, it claims the local development user, so the archive you built before
accounts existed becomes yours: its pieces and collections are kept as they are, and it gets
your email address and a password (asked for twice, never echoed or logged). The address is
treated as verified. With --user-id it promotes an existing account instead (keeping its
password unless you choose a new one with --new-password).

Refuses if another account is already the owner, or if the email belongs to someone else.
"""

import argparse
import getpass
import sys
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select

from app.core import security
from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models import User
from app.repositories.users import ensure_user


def ask_password() -> str:
    while True:
        first = getpass.getpass("New password (at least 12 characters): ")
        if not security.PASSWORD_MIN <= len(first) <= security.PASSWORD_MAX:
            print(
                f"Use {security.PASSWORD_MIN}-{security.PASSWORD_MAX} characters.", file=sys.stderr
            )
            continue
        if getpass.getpass("Again: ") == first:
            return first
        print("The two passwords differ; try again.", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--email", required=True)
    parser.add_argument("--user-id", type=UUID, help="promote this account instead")
    parser.add_argument("--name", help="display name (default: keep the current one)")
    parser.add_argument(
        "--new-password", action="store_true", help="with --user-id, also set a new password"
    )
    args = parser.parse_args(argv)
    email = args.email.strip()
    if "@" not in email:
        parser.error("--email must be an email address")

    settings = get_settings()
    with get_session_factory()() as db, db.begin():
        if args.user_id is None:
            ensure_user(db, settings.dev_user_id, settings.dev_user_name)
        user = db.get(User, args.user_id or settings.dev_user_id)
        if user is None:
            print(f"No account with id {args.user_id}.", file=sys.stderr)
            return 1
        owner = db.scalar(select(User).where(User.is_owner))
        if owner is not None and owner.id != user.id:
            print("Another account is already the owner.", file=sys.stderr)
            return 1
        taken = db.scalar(
            select(User).where(func.lower(User.email) == email.lower(), User.id != user.id)
        )
        if taken is not None:
            print("That email belongs to another account.", file=sys.stderr)
            return 1

        if args.user_id is None or args.new_password or user.password_hash is None:
            user.password_hash = security.hash_password(ask_password())
        user.email = email
        user.email_verified_at = user.email_verified_at or datetime.now(UTC)
        user.is_owner = True
        user.disabled_at = None
        if args.name:
            user.display_name = args.name.strip()[:120]
        print(f"{user.display_name} <{email}> is now the owner.")
        print(f"Sign in at {settings.public_url}/login")
    return 0


if __name__ == "__main__":
    sys.exit(main())
