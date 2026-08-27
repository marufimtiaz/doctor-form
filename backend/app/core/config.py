from __future__ import annotations

from functools import lru_cache

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Sentinel values. The app refuses to boot with these when debug is off, so a
# forgotten secret fails loudly at deploy time instead of silently shipping a
# signing key that anyone reading this repository knows.
DEV_JWT_SECRET = "dev-only-insecure-change-me-before-deploying"
DEV_ADMIN_PASSWORD = "dev-only-admin-password"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "doctor-form"
    debug: bool = False

    # Counts are reported per local day; see app/core/timeutil.py.
    app_timezone: str = "Asia/Dhaka"

    # Identity is chosen from the users list, so the list cannot start empty.
    # These seed the first admin on boot when no users exist.
    admin_name: str = "Admin"
    admin_phone: str = "+8801700000000"

    # Seeds a handful of demo agents on a fresh database so a torn-down stack
    # comes back usable. Never enable in production: these are real, usable
    # identities in a system that does not check passwords.
    seed_demo_data: bool = False

    # Signing key for access tokens. A known default would let anyone forge an
    # admin token, so production must override it.
    jwt_secret: str = DEV_JWT_SECRET
    jwt_algorithm: str = "HS256"
    # One long-lived token; there is no refresh token. Revocation comes from
    # is_active and token_version, both checked on every request.
    access_token_ttl_days: int = 30

    # Password for the seeded first admin. Without it the admin would have no
    # hash, nobody could log in, and nobody could create a user who could.
    admin_password: str = DEV_ADMIN_PASSWORD
    # Only read when seed_demo_data is true, which production pins off.
    demo_password: str = "demo-password"

    # Where extraction runs. "worker" polls in the background, "inline" runs it
    # during POST /api/surveys, "off" runs nothing. Changing this is how the
    # work moves inline or into a detached service - no code change.
    ocr_mode: str = "worker"
    # Empty disables extraction without preventing boot: OCR enriches data, it
    # does not gate the system.
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    # Swappable without a deploy: which Gemma reads a Bangla-English nameplate
    # better cannot be known without trying both against real photographs.
    ocr_model: str = "google/gemma-4-31b-it"
    ocr_poll_seconds: int = 10
    ocr_batch_size: int = 5
    ocr_max_attempts: int = 3
    ocr_timeout_seconds: int = 60
    # A claimed row whose process died is returned to pending after this.
    ocr_stale_minutes: int = 15

    # Comma-separated list of allowed origins for CORS.
    cors_origins: str = "http://localhost:5173"

    # Postgres runs as its own service so any client can connect to it
    # directly, without going through this API.
    database_url: str = "postgresql+asyncpg://app:app@postgres:5432/app"
    db_pool_size: int = 5
    db_max_overflow: int = 10

    # RustFS speaks the S3 API, so anything boto3-shaped works here.
    s3_endpoint_url: str = "http://rustfs:9000"
    # Browser-reachable origin for the same bucket. Presigned URLs are signed
    # against this host, so it must be what the client actually connects to.
    # Empty means "same as s3_endpoint_url" (correct for local dev).
    s3_public_endpoint_url: str = ""
    s3_access_key: str = "rustfsadmin"
    s3_secret_key: str = "rustfsadmin"
    s3_bucket: str = "uploads"
    s3_region: str = "us-east-1"
    # RustFS needs path-style addressing; virtual-host style assumes DNS per bucket.
    s3_use_path_style: bool = True
    presign_expiry_seconds: int = 3600
    # Disable in tests/CI where no object store is reachable.
    s3_bootstrap: bool = True

    @property
    def presign_endpoint_url(self) -> str:
        return self.s3_public_endpoint_url or self.s3_endpoint_url

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @model_validator(mode="after")
    def _refuse_insecure_defaults(self) -> Settings:
        if self.debug:
            return self
        if self.jwt_secret == DEV_JWT_SECRET:
            raise ValueError(
                "JWT_SECRET is still the development default. Set it, or anyone "
                "who has read this repository can forge an admin token."
            )
        # RFC 7518 3.2: an HMAC key shorter than the hash output weakens the
        # signature. PyJWT warns about this; better to refuse than to warn.
        if len(self.jwt_secret) < 32:
            raise ValueError(
                f"JWT_SECRET must be at least 32 characters (got {len(self.jwt_secret)}). "
                "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
            )
        if self.admin_password == DEV_ADMIN_PASSWORD:
            raise ValueError(
                "ADMIN_PASSWORD is still the development default. Set it before "
                "the first boot seeds the admin account."
            )
        return self

    @field_validator("ocr_mode")
    @classmethod
    def _known_ocr_mode(cls, value: str) -> str:
        if value not in ("worker", "inline", "off"):
            raise ValueError("ocr_mode must be 'worker', 'inline' or 'off'")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
