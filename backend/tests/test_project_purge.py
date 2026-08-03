"""Permanent project deletion removes the entire project graph and exact files."""
from pathlib import Path

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db import Base
from app.models.entities import (
    Annotation,
    AnnotationTask,
    AnnotationVersion,
    AuditLog,
    Dataset,
    ExportJob,
    IdempotencyRecord,
    LabelSchemaVersion,
    MediaAsset,
    Patient,
    Project,
    ProjectMember,
    Review,
    Role,
    Series,
    Study,
    TaskStatus,
    User,
)
from app.schemas.api import ProjectDeleteRequest
from app.services.project_purge_service import ProjectPurgeService
from app.storage.local import LocalStorageProvider


def test_sudo_purge_removes_project_graph_and_files(tmp_path: Path) -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    settings = Settings(secret_key="x" * 32, storage_root=tmp_path / "storage", export_root=tmp_path / "exports", _env_file=None)

    with Session(engine) as db:
        admin = User(username="admin", display_name="Admin", role=Role.ADMINISTRATOR, password_hash="unused")
        db.add(admin); db.flush()
        project = Project(name="Archived US", status="DELETED", created_by=admin.id, task_types=["bbox"])
        db.add(project); db.flush()
        db.add(ProjectMember(project_id=project.id, user_id=admin.id, project_role=Role.ADMINISTRATOR))
        db.add(LabelSchemaVersion(project_id=project.id, version=1, schema_json={"labels": []}, created_by=admin.id))
        dataset = Dataset(project_id=project.id, name="Images")
        patient = Patient(project_id=project.id, hashed_patient_id="patient")
        db.add_all([dataset, patient]); db.flush()
        study = Study(patient_id=patient.id, study_instance_uid="study")
        db.add(study); db.flush()
        series = Series(study_id=study.id, series_instance_uid="series")
        db.add(series); db.flush()
        asset = MediaAsset(
            dataset_id=dataset.id,
            series_id=series.id,
            storage_key=f"originals/{project.id}/image.png",
            thumbnail_key=f"thumbnails/{project.id}/image.png",
            media_type="image/png",
            original_filename="image.png",
            relative_path="folder/image.png",
            width=16,
            height=16,
            checksum="checksum",
        )
        db.add(asset); db.flush()
        task = AnnotationTask(project_id=project.id, media_asset_id=asset.id, assigned_to=admin.id, status=TaskStatus.SUBMITTED)
        db.add(task); db.flush()
        annotation = Annotation(task_id=task.id, annotation_type="bbox", label_id="lesion", created_by=admin.id)
        db.add(annotation); db.flush()
        db.add_all([
            AnnotationVersion(annotation_id=annotation.id, version=1, snapshot_json={}, created_by=admin.id),
            Review(task_id=task.id, reviewer_id=admin.id, decision="APPROVE"),
            IdempotencyRecord(user_id=admin.id, key="save-key", task_id=task.id, result_version=1),
            AuditLog(event_type="PROJECT_DELETED", actor_id=admin.id, project_id=project.id, resource_type="project", resource_id=project.id, summary="soft deleted"),
            ExportJob(project_id=project.id, format="coco", status="COMPLETED", storage_key=f"archive/{project.id}.zip", created_by=admin.id),
        ])
        db.commit()

        project_id = project.id
        project_name = project.name
        storage_key = asset.storage_key
        thumbnail_key = asset.thumbnail_key
        export_key = f"archive/{project_id}.zip"

        storage = LocalStorageProvider(settings.storage_root)
        exports = LocalStorageProvider(settings.export_root)
        storage.put(storage_key, b"image")
        storage.put(thumbnail_key or "", b"thumbnail")
        exports.put(export_key, b"export")

        result = ProjectPurgeService(db, settings).purge(admin, project_id, ProjectDeleteRequest(project_name=project_name))
        assert result == {"project_id": project_id, "deleted_assets": 1, "deleted_tasks": 1, "deleted_files": 3}
        assert not storage.resolve(storage_key).exists()
        assert not storage.resolve(thumbnail_key or "").exists()
        assert not exports.resolve(export_key).exists()

        for model in (Project, ProjectMember, LabelSchemaVersion, Dataset, Patient, Study, Series, MediaAsset, AnnotationTask, Annotation, AnnotationVersion, Review, IdempotencyRecord, ExportJob):
            assert db.scalar(select(func.count()).select_from(model)) == 0
        audit = db.scalar(select(AuditLog))
        assert audit is not None
        assert audit.event_type == "PROJECT_PERMANENTLY_DELETED"
        assert audit.project_id is None
