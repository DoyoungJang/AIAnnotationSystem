"""Create an additional administrator from environment variables."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.bootstrap import bootstrap
from app.core.security import hash_password
from app.db import SessionLocal
from app.models.entities import Role, User


def main() -> None:
    username = os.environ["NEW_ADMIN_USERNAME"]
    password = os.environ["NEW_ADMIN_PASSWORD"]
    if len(password) < 12: raise ValueError("NEW_ADMIN_PASSWORD must contain at least 12 characters")
    bootstrap()
    with SessionLocal() as db:
        db.add(User(username=username, display_name=os.getenv("NEW_ADMIN_DISPLAY_NAME", username), role=Role.ADMINISTRATOR, password_hash=hash_password(password)))
        db.commit()


if __name__ == "__main__": main()
