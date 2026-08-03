"""Manager project-data browsing and selected 7z export tests."""
import io
import json
from pathlib import Path

import py7zr
import pytest
from fastapi import HTTPException
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db import Base
from app.models.entities import Annotation, AnnotationTask, Dataset, LabelSchemaVersion, MediaAsset, Patient, Project, Role, Series, Study, TaskStatus, User
from app.services.project_data_service import ProjectDataService, safe_archive_path


@pytest.fixture()
def context(tmp_path: Path):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    settings = Settings(secret_key="x" * 32, storage_root=tmp_path / "storage", export_root=tmp_path / "exports", _env_file=None)
    with Session(engine) as db:
        admin = User(username="admin", display_name="Admin", role=Role.ADMINISTRATOR, password_hash="x")
        annotator = User(username="annotator", display_name="Annotator", role=Role.ANNOTATOR, password_hash="x")
        reviewer = User(username="reviewer", display_name="Reviewer", role=Role.REVIEWER, password_hash="x")
        db.add_all([admin, annotator, reviewer]); db.flush()
        project = Project(name="Ultrasound Study", task_types=["bbox"], created_by=admin.id)
        db.add(project); db.flush()
        dataset = Dataset(project_id=project.id, name="Imported folder")
        patient = Patient(project_id=project.id, hashed_patient_id="patient")
        db.add_all([dataset, patient]); db.flush()
        study = Study(patient_id=patient.id, study_instance_uid="study")
        db.add(study); db.flush()
        series = Series(study_id=study.id, series_instance_uid="series")
        db.add(series); db.flush()
        submitted = MediaAsset(
            dataset_id=dataset.id, series_id=series.id, storage_key="submitted.png", media_type="image/png",
            original_filename="submitted.png", relative_path="patient-1/session-a/submitted.png",
            width=64, height=48, checksum="submitted-checksum",
        )
        unworked = MediaAsset(
            dataset_id=dataset.id, series_id=series.id, storage_key="unworked.png", media_type="image/png",
            original_filename="unworked.png", relative_path="patient-1/session-b/unworked.png",
            width=64, height=48, checksum="unworked-checksum",
        )
        db.add_all([submitted, unworked]); db.flush()
        submitted_task = AnnotationTask(
            project_id=project.id, media_asset_id=submitted.id, assigned_to=annotator.id,
            reviewer_id=reviewer.id, status=TaskStatus.SUBMITTED,
        )
        unworked_task = AnnotationTask(project_id=project.id, media_asset_id=unworked.id, status=TaskStatus.ASSIGNED)
        db.add_all([submitted_task, unworked_task]); db.flush()
        db.add(Annotation(
            task_id=submitted_task.id, annotation_type="bbox", label_id="LESION",
            geometry_json={"x": 4, "y": 5, "width": 12, "height": 10},
            attributes_json={}, frame_index=0, source="human", created_by=annotator.id,
        ))
        db.add(LabelSchemaVersion(
            project_id=project.id, version=1,
            schema_json={"labels": [{"label_code": "LESION", "label_name": "Lesion", "annotation_type": "bbox", "color": "#35d4bd", "required": False}]},
            status="PUBLISHED", created_by=admin.id,
        ))
        db.commit()
        settings.storage_root.mkdir(parents=True, exist_ok=True)
        Image.new("L", (64, 48), 80).save(settings.storage_root / submitted.storage_key)
        Image.new("L", (64, 48), 100).save(settings.storage_root / unworked.storage_key)
        yield db, settings, admin, project, submitted, unworked


def test_lists_all_items_and_exports_selected_submitted_asset(context, tmp_path: Path) -> None:
    db, settings, admin, project, submitted, unworked = context
    service = ProjectDataService(db, settings)

    items = service.list_items(admin, project.id)
    assert {item.asset_id for item in items} == {submitted.id, unworked.id}
    submitted_item = next(item for item in items if item.asset_id == submitted.id)
    assert submitted_item.task_status == TaskStatus.SUBMITTED
    assert submitted_item.annotation_count == 1

    job = service.create_selected_7z(admin, project.id, [submitted.id])
    assert job.status == "COMPLETED"
    assert job.storage_key and job.storage_key.endswith(".7z")
    archive = (settings.export_root / job.storage_key).read_bytes()
    assert archive.startswith(b"7z\xbc\xaf\x27\x1c")
    with py7zr.SevenZipFile(io.BytesIO(archive), mode="r") as bundle:
        names = set(bundle.getnames())
        assert "images/patient-1/session-a/submitted.png" in names
        assert "annotations/patient-1/session-a/submitted.png.json" in names
        assert {"labels/schema.json", "manifest.json"}.issubset(names)
        unpacked = tmp_path / "unpacked"
        bundle.extract(path=unpacked, targets=["manifest.json"])
        manifest = json.loads((unpacked / "manifest.json").read_text(encoding="utf-8"))
        assert manifest["folder_structure_preserved"] is True
        assert manifest["items"][0]["annotation_count"] == 1


def test_rejects_unsubmitted_asset_and_unsafe_archive_path(context) -> None:
    db, settings, admin, project, _, unworked = context
    with pytest.raises(HTTPException) as unavailable:
        ProjectDataService(db, settings).create_selected_7z(admin, project.id, [unworked.id])
    assert unavailable.value.status_code == 422
    with pytest.raises(ValueError):
        safe_archive_path("../outside.png")
