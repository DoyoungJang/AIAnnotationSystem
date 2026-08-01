"""Generate traceable exports from approved annotations only."""
import io
import re
import zipfile
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.exporters.base import EXPORTERS
from app.models.entities import Annotation, AnnotationTask, ExportJob, LabelSchemaVersion, MediaAsset, Project, ProjectMember, Role, TaskStatus, User
from app.services.audit_service import AuditService
from app.storage.local import LocalStorageProvider


class ExportService:
    """Authorize and create deterministic training data archives."""

    def __init__(self, db: Session, settings: Settings) -> None:
        self.db, self.settings = db, settings
        self.storage = LocalStorageProvider(settings.export_root)
        self.asset_storage = LocalStorageProvider(settings.storage_root)
        self.audit = AuditService(db)

    def create(self, actor: User, project_id: str, export_format: str, folder: str = "", include_images: bool = True) -> ExportJob:
        project = self._require_project_access(actor, project_id)
        destination = normalize_export_folder(folder)
        exporter = EXPORTERS.get(export_format)
        if exporter is None:
            raise HTTPException(422, "지원하지 않는 Export 형식입니다.")
        records = self.db.execute(select(Annotation, AnnotationTask, MediaAsset).join(AnnotationTask, Annotation.task_id == AnnotationTask.id).join(MediaAsset, AnnotationTask.media_asset_id == MediaAsset.id).where(AnnotationTask.project_id == project_id, AnnotationTask.status == TaskStatus.APPROVED, Annotation.deleted.is_(False))).all()
        if not records:
            raise HTTPException(422, "Export에 필요한 승인 Annotation이 없습니다.")
        schema = self.db.scalar(select(LabelSchemaVersion).where(LabelSchemaVersion.project_id == project_id).order_by(LabelSchemaVersion.version.desc()))
        labels = schema.schema_json.get("labels", []) if schema else []
        assets: dict[str, MediaAsset] = {}
        rows = []
        for annotation, task, asset in records:
            assets[asset.id] = asset
            image_name = export_image_name(asset)
            rows.append({"task_id": task.id, "asset_id": asset.id, "original_filename": asset.original_filename, "export_filename": f"images/{image_name}" if include_images else asset.original_filename, "width": asset.width, "height": asset.height, "annotation_type": annotation.annotation_type, "label_id": annotation.label_id, "geometry": annotation.geometry_json, "frame_index": annotation.frame_index, "version": annotation.current_version})
        job = ExportJob(project_id=project_id, format=export_format, status="RUNNING", created_by=actor.id)
        self.db.add(job); self.db.flush()
        provenance = {"project_id": project_id, "label_schema_version": schema.version if schema else None, "created_by": actor.id, "created_at": datetime.now(timezone.utc).isoformat(), "approved_only": True, "format": export_format, "includes_images": include_images}
        try:
            content = exporter.export(rows, labels, provenance)
            if include_images:
                content = self._append_images(content, assets.values())
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            filename = f"{safe_filename(project.name)}-{timestamp}-{export_format}-{job.id[:8]}.zip"
            key = f"{destination}/{filename}" if destination else filename
            self.storage.put(key, content)
            job.storage_key = key; job.status = "COMPLETED"; job.completed_at = datetime.now(timezone.utc)
        except (OSError, ValueError, KeyError) as error:
            job.status = "FAILED"; job.error = "Export 변환에 실패했습니다."
            self.db.commit()
            raise HTTPException(500, job.error) from error
        self.audit.record(actor, "EXPORT_CREATED", "export", job.id, project_id, f"Approved annotations exported as {export_format} to {destination or 'root'}")
        self.db.commit()
        return job

    def list_jobs(self, actor: User, project_id: str) -> list[ExportJob]:
        self._require_project_access(actor, project_id)
        return list(self.db.scalars(select(ExportJob).where(ExportJob.project_id == project_id).order_by(ExportJob.created_at.desc())).all())

    def list_folders(self, actor: User) -> list[str]:
        self._require_manager(actor)
        folders: list[str] = []
        for path in self.settings.export_root.resolve().rglob("*"):
            if not path.is_dir():
                continue
            resolved = path.resolve()
            if self.settings.export_root.resolve() not in resolved.parents:
                continue
            folders.append(resolved.relative_to(self.settings.export_root.resolve()).as_posix())
            if len(folders) >= 200:
                break
        return sorted(folders)

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

    def _require_manager(self, actor: User) -> None:
        if actor.role not in {Role.ADMINISTRATOR, Role.PROJECT_MANAGER}:
            raise HTTPException(403, "Export 권한이 없습니다.")

    def _require_project_access(self, actor: User, project_id: str) -> Project:
        self._require_manager(actor)
        project = self.db.get(Project, project_id)
        if project is None:
            raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")
        if actor.role != Role.ADMINISTRATOR and self.db.scalar(select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.user_id == actor.id)) is None:
            raise HTTPException(403, "이 프로젝트에 접근할 권한이 없습니다.")
        return project

    def _append_images(self, content: bytes, assets: Iterable[MediaAsset]) -> bytes:
        buffer = io.BytesIO(content)
        with zipfile.ZipFile(buffer, "a", zipfile.ZIP_DEFLATED) as bundle:
            for asset in assets:
                bundle.writestr(f"images/{export_image_name(asset)}", self.asset_storage.read(asset.storage_key))
        return buffer.getvalue()


def normalize_export_folder(value: str) -> str:
    """Return a safe POSIX-style path below EXPORT_ROOT."""
    raw = value.strip().replace("\\", "/")
    if not raw:
        return ""
    if raw.startswith("/") or re.match(r"^[A-Za-z]:", raw):
        raise HTTPException(422, "저장 폴더는 Export 저장소 내부의 상대 경로로 입력하세요.")
    cleaned: list[str] = []
    windows_reserved = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
    for raw_segment in raw.split("/"):
        segment = raw_segment.strip().strip(".")
        if not segment or raw_segment.strip() in {".", ".."}:
            raise HTTPException(422, "저장 폴더 경로가 올바르지 않습니다.")
        if len(segment) > 100 or re.search(r'[<>:"|?*\x00-\x1f]', segment) or segment.split(".")[0].upper() in windows_reserved:
            raise HTTPException(422, "폴더 이름에 사용할 수 없는 문자가 있습니다.")
        cleaned.append(segment)
    return "/".join(cleaned)


def safe_filename(value: str) -> str:
    clean = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip(" .")
    return clean[:100] or "sonolabel-export"


def export_image_name(asset: MediaAsset) -> str:
    suffix = Path(asset.original_filename).suffix.lower()
    if not re.fullmatch(r"\.[a-z0-9]{1,10}", suffix):
        suffix = ".bin"
    return f"{asset.id}{suffix}"
