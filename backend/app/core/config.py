"""Environment-backed application settings."""
from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Validated runtime configuration."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    app_env: str = "development"
    database_url: str = "sqlite:///./sonolabel.db"
    secret_key: str = "development-only-change-this-secret-key"
    access_token_minutes: int = 30
    storage_root: Path = Path("./storage")
    export_root: Path = Path("./exports")
    max_upload_mb: int = 256
    lock_ttl_seconds: int = 120
    admin_username: str = "admin"
    admin_password: str = "ChangeThisBeforeUse123!"
    cors_origins: str = "http://localhost:5173,http://localhost:8080"

    @field_validator("secret_key")
    @classmethod
    def validate_secret(cls, value: str) -> str:
        if len(value) < 32:
            raise ValueError("SECRET_KEY must contain at least 32 characters")
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return one immutable settings instance per process."""
    return Settings()
