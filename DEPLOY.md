# Deploying Thread to Railway

Thread runs as three Railway services in one project: **web** (the Next.js site), **api**
(FastAPI with the image model) and **db** (PostgreSQL with pgvector), plus a volume for
uploaded images. Only `web` is public; `api` and `db` are reached over Railway's private
network, so the database is never exposed to the internet.

Why Railway and not Vercel: uploads (up to 15 MB) go through the site's `/api` proxy, and
Vercel limits request bodies to 4.5 MB. On Railway the proxy is the site's own Next.js server.

> You do every step marked **you**: creating accounts, logging in, and typing secrets into
> Railway's dashboard. Never paste a secret into a chat, an issue or a commit.

## What it costs (check Railway's pricing page when you sign up)

Usage-based: about $10 per GB of memory per month and $0.15 per GB of volume per month; the
Hobby plan's $5 fee counts toward usage. Expect roughly **$20-30/month**, mostly the API's
~1.5-2 GB of memory (the image model). The Hobby plan caps a volume at 5 GB; with the default
quota (100 pieces / 250 MB per account, the owner exempt) that holds about 15 full accounts.

## 1. Create the project (you)

1. Sign up at railway.com and choose the Hobby plan.
2. Install the CLI and log in: `npm i -g @railway/cli`, then `railway login`.
3. Push this repository to GitHub (already done) and, in Railway, **New Project → Deploy from
   GitHub repo**, picking it. Railway creates one service; you will add two more.

## 2. Database (you)

1. **New → Database template → "Postgres + pgvector"** (the template runs pgvector 0.8 and
   daily backups). Name the service `db`.
2. Note its private connection URL (`DATABASE_URL` in the template's variables). Thread needs
   the SQLAlchemy form: replace `postgresql://` with `postgresql+psycopg://`.

## 3. API service (you set variables; the repo has the build)

Service settings:

| Setting | Value |
|---|---|
| Name | `api` |
| Root directory | *(empty: the repository root)* |
| Config file | `backend/railway.json` (Dockerfile build, `alembic upgrade head` before each deploy, health check `/health`, one replica) |
| Volume | mount at `/data` |
| Public networking | **off** (private only) |
| Private networking port | `8000` |

Variables (Settings → Variables):

| Variable | Value |
|---|---|
| `THREAD_APP_ENV` | `production` |
| `THREAD_DATABASE_URL` | the `db` URL in `postgresql+psycopg://...` form (use Railway's reference variable) |
| `THREAD_PUBLIC_URL` | `https://<your web domain>` (Railway gives `https://<name>.up.railway.app`) |
| `THREAD_ALLOWED_ORIGINS` | the same `https://<your web domain>` |
| `THREAD_COOKIE_SECURE` | `true` |
| `THREAD_FORWARDED_HOPS` | `1` (see step 6) |
| `THREAD_SIGNUP_ENABLED` | `false` until email works (step 7) |
| `THREAD_MAIL_PROVIDER` | `resend` |
| `THREAD_RESEND_API_KEY` | your Resend key (or any placeholder while sign-up is closed) |
| `THREAD_EMAIL_FROM` | e.g. `Thread <no-reply@your-domain>` |
| `RAILWAY_RUN_UID` | `0` only if the logs show a permission error writing `/data` (Railway mounts volumes as root; the image runs as an unprivileged user) |

The API **refuses to start** in production without a secure cookie, an `https://` public URL,
https-only allowed origins and Resend configured; the log names what is missing.

Leave `THREAD_ANTHROPIC_API_KEY` unset: Deep Analyze stays off (and is owner-only anyway).

The image builds the model in (downloaded once at build time from its pinned Hugging Face
revision, SHA-256 checked), so starts never download anything. The first start after a deploy
takes about a minute while the model loads; `/health` says so.

## 4. Web service (you set variables; the repo has the build)

| Setting | Value |
|---|---|
| Name | `web` |
| Root directory | *(empty)* |
| Config file | `frontend/railway.json` |
| Public networking | **on**: generate a domain (port `3000`) |

Variables (these are **build** arguments, read when the image is built):

| Variable | Value |
|---|---|
| `THREAD_API_URL` | `http://api.railway.internal:8000` |
| `THREAD_CONTACT_EMAIL` | the address shown on /terms and /privacy |

Changing either needs a redeploy of `web`.

## 5. Claim the owner account (you)

Once both services are up, open a shell on the API service and claim the owner account:

```bash
railway ssh --service api
python -m scripts.claim_owner --email you@example.com --name "Your name"
```

It asks for the password twice without echoing it. Then sign in at `https://<domain>/login`,
upload pieces, and publish them with "Show in showcase".

## 6. Check it after the first deploy

- `https://<domain>/api/health` → `"status": "ok"`, `"schema_up_to_date": true`.
- `/`, `/showcase`, `/login`, `/terms` load; response headers include
  `Strict-Transport-Security` and `Content-Security-Policy`.
- `POST /api/auth/signup` answers 403 `signup_closed` while sign-up is closed.
- **Client IP for rate limits.** Railway's edge adds the visitor's address as the last entry of
  `X-Forwarded-For`, and the site's proxy passes that header through unchanged, so
  `THREAD_FORWARDED_HOPS=1` takes the real address. Check it once: ten wrong sign-ins for
  ten *different* made-up emails from your own connection should make the eleventh answer 429;
  from another network (e.g. your phone on mobile data) sign-in should still work. If a
  different network is also limited, every visitor is being counted as one address: set the
  hops to match what Railway actually sends and redeploy.

## 7. Opening sign-up (you, later)

Resend sends only from a domain you own and have verified.

1. Buy a domain (any registrar) and add it to Resend; add the DNS records Resend shows.
2. Optionally point the domain at the `web` service (Railway → Settings → Domains), then update
   `THREAD_PUBLIC_URL` and `THREAD_ALLOWED_ORIGINS` on `api`.
3. Set `THREAD_RESEND_API_KEY`, `THREAD_EMAIL_FROM` (an address at that domain) and
   `THREAD_SIGNUP_ENABLED=true` on `api`. Sign up with a second email to check the
   verification link arrives.

## Backups and restoring

- The pgvector template backs the database up daily. For your own copy:
  `railway connect db` then `pg_dump`, or
  `pg_dump "<public or tunnelled db url>" > thread-YYYY-MM-DD.sql`.
- Uploaded images live on the `api` volume. Railway can snapshot volumes; image files without
  their database rows (or the reverse) are useless, so back both up together.

## Rolling back

Railway keeps previous deployments: **Deployments → … → Rollback** on `web` or `api`.
Migrations only add columns and tables, so the previous API version runs against a newer
schema; to also undo a migration, run `alembic downgrade -1` from the API shell first.

## Limits worth knowing

- One API replica: sign-in rate limits are kept in that process's memory.
- Published images are cached for 5 minutes; showcase responses are size-capped (see README).
- There is no viewing rate limit on the showcase yet; add Railway's or a CDN's if you see
  scraping.
