"""Irreversible cleanup for projects already placed in the recycle bin."""
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import Settings
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
    User,
)
from app.schemas.api import ProjectDeleteRequest
from app.storage.local import LocalStorageProvider


class ProjectPurgeService:
    """List and permanently remove soft-deleted projects for Sudo admins."""

    def __init__(self, db: Session, settings: Settings) -> None:
        self.db = db
        self.settings = settings

    @staticmethod
    def _require_sudo(actor: User) -> None:
        if actor.role != Role.ADMINISTRATOR:
            raise HTTPException(403, "Sudo 관리자 권한이 필요합니다.")

    def list_deleted(self, actor: User) -> list[Project]:
        self._require_sudo(actor)
        return list(self.db.scalars(
            select(Project).where(Project.status == "DELETED").order_by(Project.updated_at.desc())
        ).all())

    @staticmethod
    def _delete_file(provider: LocalStorageProvider, key: str | None) -> tuple[int, Path | None]:
        if not key:
            return 0, None
        try:
            path = provider.resolve(key)
        except ValueError as error:
            raise HTTPException(500, "삭제 대상 파일 경로가 안전하지 않습니다.") from error
        if not path.exists():
            return 0, path
        if not path.is_file():
            raise HTTPException(500, "삭제 대상 경로가 파일이 아닙니다.")
        try:
            path.unlink()
        except OSError as error:
            raise HTTPException(500, "프로젝트 파일을 정리하지 못했습니다. 잠시 후 다시 시도해 주세요.") from error
        return 1, path

    @staticmethod
    def _prune_empty_parent(path: Path, root: Path) -> None:
        """Remove only empty parents, and never the configured storage root itself."""
        parent = path.parent
        root = root.resolve()
        while parent != root and root in parent.parents:
            try:
                parent.rmdir()
            except OSError:
                break
            parent = parent.parent

    def purge(self, actor: User, project_id: str, payload: ProjectDeleteRequest) -> dict[str, int | str]:
        self._require_sudo(actor)
        project = self.db.get(Project, project_id)
        if project is None:
            raise HTTPException(404, "삭제된 프로젝트를 찾을 수 없습니다.")
        if project.status != "DELETED":
            raise HTTPException(409, "논리 삭제된 프로젝트만 완전히 삭제할 수 있습니다.")
        if payload.project_name != project.name:
            raise HTTPException(422, "프로젝트 이름이 일치하지 않습니다.")

        dataset_ids = list(self.db.scalars(select(Dataset.id).where(Dataset.project_id == project_id)).all())
        patient_ids = list(self.db.scalars(select(Patient.id).where(Patient.project_id == project_id)).all())
        study_ids = list(self.db.scalars(select(Study.id).where(Study.patient_id.in_(patient_ids))).all()) if patient_ids else []
        series_ids = list(self.db.scalars(select(Series.id).where(Series.study_id.in_(study_ids))).all()) if study_ids else []
        assets = list(self.db.scalars(select(MediaAsset).where(MediaAsset.dataset_id.in_(dataset_ids))).all()) if dataset_ids else []
        task_ids = list(self.db.scalars(select(AnnotationTask.id).where(AnnotationTask.project_id == project_id)).all())
        annotation_ids = list(self.db.scalars(select(Annotation.id).where(Annotation.task_id.in_(task_ids))).all()) if task_ids else []
        export_jobs = list(self.db.scalars(select(ExportJob).where(ExportJob.project_id == project_id)).all())

        # Remove only file keys recorded for this project. If cleanup fails, the
        # project remains in the recycle bin so a Sudo admin can safely retry.
        storage = LocalStorageProvider(self.settings.storage_root)
        exports = LocalStorageProvider(self.settings.export_root)
        deleted_files = 0
        storage_paths: list[Path] = []
        export_paths: list[Path] = []
        for asset in assets:
            for key in (asset.storage_key, asset.thumbnail_key):
                if key:
                    deleted, path = self._delete_file(storage, key)
                    deleted_files += deleted
                    if path:
                        storage_paths.append(path)
        for job in export_jobs:
            if job.storage_key:
                deleted, path = self._delete_file(exports, job.storage_key)
                deleted_files += deleted
                if path:
                    export_paths.append(path)

        for path in storage_paths:
            self._prune_empty_parent(path, self.settings.storage_root)
        for path in export_paths:
            self._prune_empty_parent(path, self.settings.export_root)

        if annotation_ids:
            self.db.execute(delete(AnnotationVersion).where(AnnotationVersion.annotation_id.in_(annotation_ids)))
        if task_ids:
            self.db.execute(delete(Annotation).where(Annotation.task_id.in_(task_ids)))
            self.db.execute(delete(Review).where(Review.task_id.in_(task_ids)))
            self.db.execute(delete(IdempotencyRecord).where(IdempotencyRecord.task_id.in_(task_ids)))
        self.db.execute(delete(AnnotationTask).where(AnnotationTask.project_id == project_id))
        if dataset_ids:
            self.db.execute(delete(MediaAsset).where(MediaAsset.dataset_id.in_(dataset_ids)))
        if series_ids:
            self.db.execute(delete(Series).where(Series.id.in_(series_ids)))
        if study_ids:
            self.db.execute(delete(Study).where(Study.id.in_(study_ids)))
        self.db.execute(delete(Patient).where(Patient.project_id == project_id))
        self.db.execute(delete(Dataset).where(Dataset.project_id == project_id))
        self.db.execute(delete(LabelSchemaVersion).where(LabelSchemaVersion.project_id == project_id))
        self.db.execute(delete(ProjectMember).where(ProjectMember.project_id == project_id))
        self.db.execute(delete(ExportJob).where(ExportJob.project_id == project_id))
        self.db.execute(delete(AuditLog).where(AuditLog.project_id == project_id))
        self.db.delete(project)
        self.db.add(AuditLog(
            event_type="PROJECT_PERMANENTLY_DELETED",
            actor_id=actor.id,
            project_id=None,
            resource_type="project",
            resource_id=project_id,
            summary="Project permanently deleted by Sudo administrator",
        ))
        self.db.commit()
        return {
            "project_id": project_id,
            "deleted_assets": len(assets),
            "deleted_tasks": len(task_ids),
            "deleted_files": deleted_files,
        }
