"""Generate traceable exports from approved annotations only."""
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.exporters.base import EXPORTERS
from app.models.entities import Annotation, AnnotationTask, ExportJob, LabelSchemaVersion, MediaAsset, ProjectMember, Role, TaskStatus, User
from app.services.audit_service import AuditService
from app.storage.local import LocalStorageProvider


class ExportService:
    """Authorize and create deterministic training data archives."""

    def __init__(self, db: Session, settings: Settings) -> None:
        self.db, self.settings = db, settings
        self.storage = LocalStorageProvider(settings.export_root)
        self.audit = AuditService(db)

    def create(self, actor: User, project_id: str, export_format: str) -> ExportJob:
        if actor.role not in {Role.ADMINISTRATOR, Role.PROJECT_MANAGER}:
            raise HTTPException(403, "Export 권한이 없습니다.")
        if actor.role != Role.ADMINISTRATOR and self.db.scalar(select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.user_id == actor.id)) is None:
            raise HTTPException(403, "이 프로젝트에 접근할 권한이 없습니다.")
        exporter = EXPORTERS.get(export_format)
        if exporter is None:
            raise HTTPException(422, "지원하지 않는 Export 형식입니다.")
        records = self.db.execute(select(Annotation, AnnotationTask, MediaAsset).join(AnnotationTask, Annotation.task_id == AnnotationTask.id).join(MediaAsset, AnnotationTask.media_asset_id == MediaAsset.id).where(AnnotationTask.project_id == project_id, AnnotationTask.status == TaskStatus.APPROVED, Annotation.deleted.is_(False))).all()
        if not records:
            raise HTTPException(422, "Export에 필요한 승인 Annotation이 없습니다.")
        schema = self.db.scalar(select(LabelSchemaVersion).where(LabelSchemaVersion.project_id == project_id).order_by(LabelSchemaVersion.version.desc()))
        labels = schema.schema_json.get("labels", []) if schema else []
        rows = [{"task_id": task.id, "asset_id": asset.id, "original_filename": asset.original_filename, "width": asset.width, "height": asset.height, "annotation_type": annotation.annotation_type, "label_id": annotation.label_id, "geometry": annotation.geometry_json, "frame_index": annotation.frame_index, "version": annotation.current_version} for annotation, task, asset in records]
        job = ExportJob(project_id=project_id, format=export_format, status="RUNNING", created_by=actor.id)
        self.db.add(job); self.db.flush()
        provenance = {"project_id": project_id, "label_schema_version": schema.version if schema else None, "created_by": actor.id, "created_at": datetime.now(timezone.utc).isoformat(), "approved_only": True, "format": export_format}
        try:
            content = exporter.export(rows, labels, provenance)
            key = f"{project_id}/{job.id}-{export_format}.zip"
            self.storage.put(key, content)
            job.storage_key = key; job.status = "COMPLETED"; job.completed_at = datetime.now(timezone.utc)
        except (OSError, ValueError, KeyError) as error:
            job.status = "FAILED"; job.error = "Export 변환에 실패했습니다."
            self.db.commit()
            raise HTTPException(500, job.error) from error
        self.audit.record(actor, "EXPORT_CREATED", "export", job.id, project_id, f"Approved annotations exported as {export_format}")
        self.db.commit()
        return job

    def get(self, actor: User, job_id: str) -> ExportJob:
        job = self.db.get(ExportJob, job_id)
        if job is None: raise HTTPException(404, "Export를 찾을 수 없습니다.")
        if actor.role not in {Role.ADMINISTRATOR, Role.PROJECT_MANAGER}: raise HTTPException(403, "Export 권한이 없습니다.")
        if actor.role != Role.ADMINISTRATOR and self.db.scalar(select(ProjectMember).where(ProjectMember.project_id == job.project_id, ProjectMember.user_id == actor.id)) is None: raise HTTPException(403, "이 프로젝트에 접근할 권한이 없습니다.")
        return job

    def download(self, actor: User, job_id: str) -> bytes:
        job = self.get(actor, job_id)
        if job.status != "COMPLETED" or not job.storage_key: raise HTTPException(409, "Export가 아직 완료되지 않았습니다.")
        return self.storage.read(job.storage_key)
