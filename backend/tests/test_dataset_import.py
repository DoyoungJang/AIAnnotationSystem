"""Original preservation and raster import tests."""
from io import BytesIO
from pathlib import Path

from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db import Base
from app.models.entities import Project, Role, User
from app.services.dataset_service import DatasetService


def test_import_preserves_original_and_creates_thumbnail(tmp_path: Path) -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    source = BytesIO(); Image.new("L", (128, 96), 80).save(source, "PNG"); original = source.getvalue()
    settings = Settings(secret_key="x" * 32, storage_root=tmp_path / "storage", export_root=tmp_path / "exports", _env_file=None)
    with Session(engine) as db:
        admin = User(username="admin", display_name="Admin", role=Role.ADMINISTRATOR, password_hash="x"); db.add(admin); db.flush()
        project = Project(name="P", task_types=["bbox"], created_by=admin.id); db.add(project); db.commit()
        _, assets, duplicates = DatasetService(db, settings).import_files(admin, project.id, "D", [("sample.png", "image/png", original)])
        assert duplicates == 0 and len(assets) == 1
        assert (settings.storage_root / assets[0].storage_key).read_bytes() == original
        assert (settings.storage_root / assets[0].thumbnail_key).exists()
