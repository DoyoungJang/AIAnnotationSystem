"""Annotation lock, version, review and approved export integration tests."""
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db import Base
from app.models.entities import AnnotationTask, Dataset, MediaAsset, Patient, Project, Review, Role, Series, Study, TaskStatus, User
from app.schemas.api import AnnotationInput, AnnotationSaveRequest, ReviewRequest
from app.services.annotation_service import AnnotationService
from app.services.review_service import ReviewService


@pytest.fixture()
def context(tmp_path: Path):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    settings = Settings(secret_key="x" * 32, storage_root=tmp_path / "storage", export_root=tmp_path / "exports", _env_file=None)
    with Session(engine) as db:
        annotator = User(username="annotator", display_name="Annotator", role=Role.ANNOTATOR, password_hash="x")
        reviewer = User(username="reviewer", display_name="Reviewer", role=Role.REVIEWER, password_hash="x")
        db.add_all([annotator, reviewer]); db.flush()
        project = Project(name="Study", task_types=["bbox"], created_by=annotator.id); db.add(project); db.flush()
        dataset = Dataset(project_id=project.id, name="D"); patient = Patient(project_id=project.id, hashed_patient_id="h")
        db.add_all([dataset, patient]); db.flush()
        study = Study(patient_id=patient.id, study_instance_uid="st"); db.add(study); db.flush()
        series = Series(study_id=study.id, series_instance_uid="se"); db.add(series); db.flush()
        asset = MediaAsset(dataset_id=dataset.id, series_id=series.id, storage_key="x.png", media_type="image/png", original_filename="x.png", width=100, height=80, checksum="c")
        db.add(asset); db.flush()
        task = AnnotationTask(project_id=project.id, media_asset_id=asset.id, assigned_to=annotator.id, reviewer_id=reviewer.id, status=TaskStatus.ASSIGNED)
        db.add(task); db.commit()
        yield db, settings, annotator, reviewer, task


def test_lock_save_version_conflict_submit_and_review(context) -> None:
    db, settings, annotator, reviewer, task = context
    service = AnnotationService(db, settings)
    service.acquire_lock(annotator, task.id)
    payload = AnnotationSaveRequest(client_version=0, annotations=[AnnotationInput(annotation_type="bbox", label_id="HEAD", image_width=100, image_height=80, geometry={"x": 10, "y": 10, "width": 20, "height": 15})])
    saved_task, annotations = service.save(annotator, task.id, payload, "one")
    assert saved_task.aggregate_version == 1
    assert annotations[0].current_version == 1
    with pytest.raises(HTTPException) as conflict:
        service.save(annotator, task.id, payload, "two")
    assert conflict.value.status_code == 409
    submitted = service.submit(annotator, task.id)
    assert submitted.status == TaskStatus.SUBMITTED
    approved = ReviewService(db).review(reviewer, task.id, ReviewRequest(decision="APPROVED", comment="ok"))
    assert approved.status == TaskStatus.APPROVED
    assert db.query(Review).count() == 1


def test_geometry_rejects_out_of_bounds_bbox() -> None:
    with pytest.raises(ValueError):
        AnnotationInput(annotation_type="bbox", label_id="HEAD", image_width=100, image_height=80, geometry={"x": 90, "y": 10, "width": 20, "height": 15})
