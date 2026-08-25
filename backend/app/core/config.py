from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "doctor-form"
    debug: bool = False

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
