"""Database bootstrap for local and container startup."""
import logging

from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import hash_password
from app.db import Base, SessionLocal, engine
from app.models.entities import Role, User

logger = logging.getLogger(__name__)


def bootstrap() -> None:
    """Create tables and a first administrator idempotently."""
    settings = get_settings()
    settings.storage_root.mkdir(parents=True, exist_ok=True)
    settings.export_root.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if db.scalar(select(User).where(User.username == settings.admin_username)) is None:
            db.add(User(username=settings.admin_username, display_name="System Administrator", role=Role.ADMINISTRATOR, password_hash=hash_password(settings.admin_password)))
            db.commit()
            logger.info("Initial administrator created", extra={"event": "bootstrap_admin"})


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    bootstrap()
