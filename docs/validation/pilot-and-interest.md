# Studio pilot and interest: running it

Milestone M11-B. How visitors register interest, where you see it, and what you can set. The
interviews themselves are in [interview-guide.md](interview-guide.md).

## What visitors see

- **`/pilot`**: the studio pilot offer (what it includes, what it doesn't yet, the price) and one
  form with two choices: *my studio, label or boutique* (asks what they do: stylist, designer or
  label, boutique or shop, textile researcher, collector or reseller, student, something else) or
  *my own wardrobe* (early access for when sign-up opens).
- Links to it: *Join the studio pilot* on the landing page, *Studio pilot* in the footer, and
  *Leave your email* when someone tries to sign up while sign-up is closed (that link opens the
  form on the wardrobe choice).

## Where you see it

**Accounts → Interest** (owner only): three counts side by side, which is the comparison M11 is
about:

| Count | Meaning |
| --- | --- |
| Wardrobe accounts | Accounts other than yours (and how many confirmed their email) |
| Wardrobe early access | People waiting for sign-up to open |
| Studio pilot | Professionals, broken down by what they do |

Then every registration, newest first, with *Contacted* (tick it when you've written or called;
it keeps the date) and *Delete* (asks to confirm). Copy the rows you follow up into your
interview notes using the codes from the guide, not names.

## Settings (on the `web` service)

| Variable | Effect |
| --- | --- |
| `THREAD_CONTACT_EMAIL` | Your public address. Shown on `/pilot`, the landing page's studio column and the legal pages. Unset: no address is shown. |
| `THREAD_PILOT_PRICE` | e.g. `₹2,999, once`. Shown on `/pilot`. Unset: "Agreed with you before we start." Only set it once you've decided; it's a public offer. |

Both are read when the site is built, like `THREAD_PUBLIC_URL`.

## Privacy rules (enforced in `backend/app/services/interest.py`)

- Nothing is kept without the consent box; its moment is stored with the row.
- The form answers the same way for a new or an already-registered address, and registering
  again updates the row (one per address and kind) instead of adding a copy.
- A hidden field catches bots: they get the usual answer and nothing is stored.
- Five registrations per network and three per address, per hour. Cross-site posts are refused.
- Only the owner can list, mark or delete. Rows are deleted automatically a year after their last
  update; delete one sooner whenever someone asks (the privacy page says so).
- Addresses and messages are never logged and never sent anywhere: no email is sent on
  registration, and no third-party form or analytics service is involved.
