"""Original preservation and raster import tests."""
from io import BytesIO
from pathlib import Path

from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db import Base
from app.models.entities import Project, Role, User
from app.services.dataset_service import DatasetService, normalize_relative_path


def test_import_preserves_original_and_creates_thumbnail(tmp_path: Path) -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    source = BytesIO(); Image.new("L", (128, 96), 80).save(source, "PNG"); original = source.getvalue()
    settings = Settings(secret_key="x" * 32, storage_root=tmp_path / "storage", export_root=tmp_path / "exports", _env_file=None)
    with Session(engine) as db:
        admin = User(username="admin", display_name="Admin", role=Role.ADMINISTRATOR, password_hash="x"); db.add(admin); db.flush()
        project = Project(name="P", task_types=["bbox"], created_by=admin.id); db.add(project); db.commit()
        _, assets, duplicates = DatasetService(db, settings).import_files(admin, project.id, "D", [("Breast cancer/benign/images/sample.png", "image/png", original)])
        assert duplicates == 0 and len(assets) == 1
        assert assets[0].relative_path == "Breast cancer/benign/images/sample.png"
        assert assets[0].original_filename == "sample.png"
        assert (settings.storage_root / assets[0].storage_key).read_bytes() == original
        assert (settings.storage_root / assets[0].thumbnail_key).exists()


def test_import_keeps_identical_content_at_different_folder_paths(tmp_path: Path) -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    source = BytesIO(); Image.new("L", (32, 24), 40).save(source, "PNG"); original = source.getvalue()
    settings = Settings(secret_key="x" * 32, storage_root=tmp_path / "storage", export_root=tmp_path / "exports", _env_file=None)
    with Session(engine) as db:
        admin = User(username="admin", display_name="Admin", role=Role.ADMINISTRATOR, password_hash="x"); db.add(admin); db.flush()
        project = Project(name="P", task_types=["bbox"], created_by=admin.id); db.add(project); db.commit()
        _, assets, duplicates = DatasetService(db, settings).import_files(admin, project.id, "D", [
            ("root/benign/sample.png", "image/png", original),
            ("root/malignant/sample.png", "image/png", original),
        ])
        assert duplicates == 0
        assert [asset.relative_path for asset in assets] == ["root/benign/sample.png", "root/malignant/sample.png"]


def test_relative_path_rejects_path_traversal_and_absolute_paths() -> None:
    from fastapi import HTTPException
    import pytest

    assert normalize_relative_path("root/benign/sample.png") == "root/benign/sample.png"
    for unsafe in ("../sample.png", "root/../sample.png", "/tmp/sample.png", r"C:\\data\\sample.png", "root//sample.png"):
        with pytest.raises(HTTPException):
            normalize_relative_path(unsafe)
