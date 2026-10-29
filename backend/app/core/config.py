"""Application settings, loaded from environment variables and the repo-root .env file."""

from functools import lru_cache
from pathlib import Path
from typing import Literal
from uuid import UUID

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Prefixed so generic machine-wide variables (e.g. another project's DATABASE_URL)
        # can never leak into Thread. THREAD_DATABASE_URL -> database_url.
        env_prefix="THREAD_",
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Thread API"
    app_version: str = "0.1.0"
    app_env: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"

    database_url: str = Field(
        description="SQLAlchemy URL, e.g. postgresql+psycopg://user:pass@host:5434/thread",
    )
    test_database_url: str | None = None

    # The local development user: it owns the archive built before accounts existed and
    # becomes the owner account once claimed (`python -m scripts.claim_owner`). With
    # dev_auto_signin, a request without a session acts as this user, in development only,
    # so local work needs no sign-in; it is never honoured in test or production.
    dev_user_id: UUID = UUID("00000000-0000-4000-8000-000000000001")
    dev_user_name: str = "Local developer"
    dev_auto_signin: bool = True

    # Accounts. Sessions live in an HttpOnly cookie on the site's own origin (the Next.js
    # proxy forwards /api), so the browser never sees a token it could leak to scripts.
    signup_enabled: bool = True
    session_days: int = Field(default=30, ge=1, le=365)
    session_cookie_name: str = "thread_session"
    cookie_secure: bool = False  # must be true in production (HTTPS only)
    # Browser origins allowed to send state-changing requests (comma-separated).
    allowed_origins: str = "http://127.0.0.1:3100,http://localhost:3100,http://127.0.0.1:3101"
    # Base URL of the site, used in links inside emails.
    public_url: str = "http://127.0.0.1:3100"
    # Client IP for rate limits: 0 uses the socket address; N > 0 takes the Nth address from
    # the right of X-Forwarded-For (the hop your own proxies added), which a client can't forge.
    forwarded_hops: int = Field(default=0, ge=0, le=5)
    signup_limit_per_hour: int = Field(default=5, ge=1)  # per IP
    login_limit_per_15_minutes: int = Field(default=10, ge=1)  # per IP and per email
    email_limit_per_hour: int = Field(default=3, ge=1)  # verification / reset mails per address
    # Per-account storage, so one account can't fill the disk. The owner is exempt.
    quota_items: int = Field(default=200, ge=1)
    quota_bytes: int = Field(default=1024**3, ge=1)

    # Email. "log" writes messages (with their links) to the API log instead of sending
    # them, for development and tests; "resend" sends through https://resend.com.
    mail_provider: Literal["log", "resend"] = "log"
    resend_api_key: SecretStr | None = None
    email_from: str = "Thread <no-reply@thread.local>"

    # Uploaded files. Kept outside the frontend's public/ folder and served only through the
    # API, which checks ownership. Relative paths resolve against the repo root.
    storage_dir: Path = Path("storage")

    # Upload limits.
    max_upload_bytes: int = Field(default=15 * 1024 * 1024, gt=0)
    max_image_side: int = Field(default=8000, gt=0)
    min_image_side: int = Field(default=64, gt=0)
    # Decompression-bomb guard: total pixels Pillow may decode.
    max_image_pixels: int = Field(default=40_000_000, gt=0)
    thumbnail_side: int = Field(default=640, gt=0)

    # Number of dominant colours to extract (before near-duplicates are merged).
    palette_size: int = Field(default=6, ge=1, le=12)

    # Image embeddings. Weights live under the project (git-ignored) and are fetched only by
    # `python -m scripts.fetch_model`; the API never downloads them.
    model_cache_dir: Path = Path(".cache/models")
    embeddings_enabled: bool = True
    # Load the model in a background thread at startup (if weights exist) so the first
    # upload does not pay the load time. Startup never waits for it.
    embedding_warmup: bool = True

    # Read by the Next.js proxy; declared here so the shared .env is self-documenting.
    api_url: str = "http://127.0.0.1:8010"

    # Deep analysis (optional, user-triggered; sends one image to Anthropic per run).
    # Only these THREAD_ settings are used: machine-wide ANTHROPIC_* variables, CLI login
    # profiles and system proxies are ignored (see app/ml/deep_analyzer.py). Without a key no
    # client is built and nothing is sent.
    anthropic_api_key: SecretStr | None = None
    anthropic_base_url: str = "https://api.anthropic.com"
    deep_analysis_model: str = "claude-opus-5-5"
    deep_analysis_effort: Literal["low", "medium", "high", "xhigh", "max"] = "medium"
    # A guard against runaway use, not a spending limit: counted per user per UTC day.
    deep_analysis_daily_limit: int = Field(default=25, ge=0)
    deep_analysis_timeout_seconds: float = Field(default=120.0, gt=0, le=600)
    # "fake" is a local stand-in for development and end-to-end tests (never in production):
    # it returns a canned description and sends nothing anywhere.
    deep_analysis_provider: Literal["claude", "fake"] = "claude"

    @field_validator("anthropic_api_key", "resend_api_key", mode="before")
    @classmethod
    def _blank_key_is_no_key(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value

    @model_validator(mode="after")
    def _safe_in_production(self) -> "Settings":
        """Refuse to start a public deployment that would leak sessions or drop emails."""
        if self.app_env != "production":
            return self
        problems = []
        if not self.cookie_secure:
            problems.append("THREAD_COOKIE_SECURE must be true")
        if not self.public_url.startswith("https://"):
            problems.append("THREAD_PUBLIC_URL must be an https:// URL")
        if self.mail_provider != "resend" or self.resend_api_key is None:
            problems.append("THREAD_MAIL_PROVIDER=resend and THREAD_RESEND_API_KEY are required")
        if any(not o.startswith("https://") for o in self.origins):
            problems.append("THREAD_ALLOWED_ORIGINS must list only https:// origins")
        if problems:
            raise ValueError("Unsafe production settings: " + "; ".join(problems))
        return self

    @property
    def origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.allowed_origins.split(",") if o.strip()]

    @field_validator("anthropic_base_url")
    @classmethod
    def _https_base_url(cls, value: str) -> str:
        if not value.startswith("https://") or len(value) <= len("https://"):
            raise ValueError("THREAD_ANTHROPIC_BASE_URL must be an https:// URL")
        return value.rstrip("/")

    @property
    def storage_root(self) -> Path:
        return self.storage_dir if self.storage_dir.is_absolute() else REPO_ROOT / self.storage_dir

    @property
    def model_cache_root(self) -> Path:
        path = self.model_cache_dir
        return path if path.is_absolute() else REPO_ROOT / path


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
