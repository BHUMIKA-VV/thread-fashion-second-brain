"""Settle payments that no webhook settled, by asking Razorpay (test mode) directly.

  python -m scripts.reconcile_payments            # report only: writes nothing
  python -m scripts.reconcile_payments --apply    # settle what Razorpay says is settled

Looks at payments still unpaid or failed that are older than --minutes (default 15) and
younger than --days (default 7), asks Razorpay for every attempt on each order, and settles a
payment Razorpay captured (granting its access period) or one where every attempt failed.
Attempts still open (authorized, created) are left alone. It goes through the same checks
as the browser and webhooks: the order, amount and currency must match what Thread stored.

Needs THREAD_RAZORPAY_KEY_ID and THREAD_RAZORPAY_KEY_SECRET (test keys). Prints Thread's own
payment ids and statuses only: no amounts, names, emails or payment details.
"""

import argparse
import sys
from datetime import timedelta

from app.billing.razorpay import provider_for
from app.core.config import get_settings
from app.db.session import get_session_factory
from app.services.billing import BillingService, BillingUnavailable


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--apply", action="store_true", help="write the changes (default: report)")
    parser.add_argument("--minutes", type=int, default=15, help="skip payments younger than this")
    parser.add_argument("--days", type=int, default=7, help="skip payments older than this")
    args = parser.parse_args(argv)
    if args.minutes < 1 or args.days < 1:
        parser.error("--minutes and --days must be at least 1")

    settings = get_settings()
    provider = provider_for(settings)
    with get_session_factory()() as db:
        service = BillingService(db, settings, provider)
        try:
            report = service.reconcile(
                settle_after=timedelta(minutes=args.minutes),
                look_back=timedelta(days=args.days),
                apply=args.apply,
            )
        except BillingUnavailable as exc:
            print(exc.message, file=sys.stderr)
            return 2
    for row in report:
        note = f" ({row.note})" if row.note else ""
        print(f"{row.payment_id}  {row.before} -> {row.after}{note}")
    mode = "settled" if args.apply else "would settle (run with --apply to write)"
    changed = sum(1 for r in report if r.after not in ("unchanged", "unreachable"))
    print(f"{len(report)} unsettled payment(s) checked; {changed} {mode}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
