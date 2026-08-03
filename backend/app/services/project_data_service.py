"""Manager-facing project data browsing and selected 7z exports."""
import io
import json
from datetime import datetime, timezone
from pathlib import PurePosixPath

import py7zr
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.entities import Annotation, AnnotationTask, Dataset, ExportJob, LabelSchemaVersion, MediaAsset, Project, ProjectMember, Role, TaskStatus, User
from app.schemas.api import ProjectDataItemOut
from app.services.audit_service import AuditService
from app.services.export_service import safe_filename
from app.storage.local import LocalStorageProvider


EXPORTABLE_STATUSES = {TaskStatus.SUBMITTED, TaskStatus.IN_REVIEW, TaskStatus.APPROVED, TaskStatus.REJECTED}


class ProjectDataService:
    def __init__(self, db: Session, settings: Settings) -> None:
        self.db = db
        self.settings = settings
        self.asset_storage = LocalStorageProvider(settings.storage_root)
        self.export_storage = LocalStorageProvider(settings.export_root)
        self.audit = AuditService(db)

    def list_items(self, actor: User, project_id: str) -> list[ProjectDataItemOut]:
        self._require_project_access(actor, project_id)
        asset_rows = self.db.execute(
            select(MediaAsset, Dataset.name)
            .join(Dataset, Dataset.id == MediaAsset.dataset_id)
            .where(Dataset.project_id == project_id)
            .order_by(MediaAsset.relative_path, MediaAsset.created_at)
        ).all()
        tasks = self.db.scalars(
            select(AnnotationTask)
            .where(AnnotationTask.project_id == project_id)
            .order_by(AnnotationTask.updated_at.desc(), AnnotationTask.created_at.desc())
        ).all()
        task_by_asset: dict[str, AnnotationTask] = {}
        for task in tasks:
            task_by_asset.setdefault(task.media_asset_id, task)
        task_ids = [task.id for task in task_by_asset.values()]
        annotation_counts = dict(self.db.execute(
            select(Annotation.task_id, func.count(Annotation.id))
            .where(Annotation.task_id.in_(task_ids), Annotation.deleted.is_(False))
            .group_by(Annotation.task_id)
        ).all()) if task_ids else {}
        return [
            ProjectDataItemOut(
                asset_id=asset.id,
                dataset_id=asset.dataset_id,
                dataset_name=dataset_name,
                original_filename=asset.original_filename,
                relative_path=asset.relative_path or asset.original_filename,
                media_type=asset.media_type,
                width=asset.width,
                height=asset.height,
                frame_count=asset.frame_count,
                phi_suspected=asset.phi_suspected,
                created_at=asset.created_at,
                task_id=task.id if task else None,
                task_status=task.status if task else None,
                assigned_to=task.assigned_to if task else None,
                reviewer_id=task.reviewer_id if task else None,
                annotation_count=annotation_counts.get(task.id, 0) if task else 0,
            )
            for asset, dataset_name in asset_rows
            for task in [task_by_asset.get(asset.id)]
        ]

    def create_selected_7z(self, actor: User, project_id: str, asset_ids: list[str]) -> ExportJob:
        project = self._require_project_access(actor, project_id)
        requested = set(asset_ids)
        assets = list(self.db.scalars(
            select(MediaAsset)
            .join(Dataset, Dataset.id == MediaAsset.dataset_id)
            .where(Dataset.project_id == project_id, MediaAsset.id.in_(requested))
            .order_by(MediaAsset.relative_path, MediaAsset.created_at)
        ).all())
        if {asset.id for asset in assets} != requested:
            raise HTTPException(422, "선택한 영상 중 이 프로젝트에 속하지 않는 항목이 있습니다.")
        tasks = self.db.scalars(
            select(AnnotationTask)
            .where(AnnotationTask.project_id == project_id, AnnotationTask.media_asset_id.in_(requested))
            .order_by(AnnotationTask.updated_at.desc(), AnnotationTask.created_at.desc())
        ).all()
        task_by_asset: dict[str, AnnotationTask] = {}
        for task in tasks:
            task_by_asset.setdefault(task.media_asset_id, task)
        unavailable = [asset for asset in assets if task_by_asset.get(asset.id) is None or task_by_asset[asset.id].status not in EXPORTABLE_STATUSES]
        if unavailable:
            raise HTTPException(422, f"제출 또는 검수가 완료되지 않은 영상 {len(unavailable)}개는 7z로 저장할 수 없습니다.")

        selected_tasks = [task_by_asset[asset.id] for asset in assets]
        annotations_by_task: dict[str, list[Annotation]] = {task.id: [] for task in selected_tasks}
        for annotation in self.db.scalars(
            select(Annotation)
            .where(Annotation.task_id.in_(list(annotations_by_task)), Annotation.deleted.is_(False))
            .order_by(Annotation.task_id, Annotation.frame_index, Annotation.created_at)
        ).all():
            annotations_by_task[annotation.task_id].append(annotation)
        schema = self.db.scalar(select(LabelSchemaVersion).where(LabelSchemaVersion.project_id == project_id).order_by(LabelSchemaVersion.version.desc()))
        job = ExportJob(project_id=project_id, format="selected-7z", status="RUNNING", created_by=actor.id)
        self.db.add(job)
        self.db.flush()
        try:
            archive = self._build_archive(project, assets, task_by_asset, annotations_by_task, schema)
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            filename = f"{safe_filename(project.name)}-{timestamp}-selected-{job.id[:8]}.7z"
            self.export_storage.put(filename, archive)
            job.storage_key = filename
            job.status = "COMPLETED"
            job.completed_at = datetime.now(timezone.utc)
        except Exception as error:
            job.status = "FAILED"
            job.error = "선택 영상 7z 생성에 실패했습니다."
            self.db.commit()
            raise HTTPException(500, job.error) from error
        self.audit.record(actor, "PROJECT_DATA_EXPORTED", "export", job.id, project_id, f"Exported {len(assets)} selected submitted assets as 7z")
        self.db.commit()
        return job

    def _build_archive(
        self,
        project: Project,
        assets: list[MediaAsset],
        task_by_asset: dict[str, AnnotationTask],
        annotations_by_task: dict[str, list[Annotation]],
        schema: LabelSchemaVersion | None,
    ) -> bytes:
        buffer = io.BytesIO()
        manifest_items: list[dict[str, object]] = []
        used_paths: set[str] = set()
        with py7zr.SevenZipFile(buffer, mode="w") as bundle:
            for asset in assets:
                task = task_by_asset[asset.id]
                relative_path = unique_archive_path(safe_archive_path(asset.relative_path or asset.original_filename), asset.id, used_paths)
                image_path = f"images/{relative_path}"
                annotation_path = f"annotations/{relative_path}.json"
                bundle.writestr(self.asset_storage.read(asset.storage_key), image_path)
                annotation_payload = {
                    "project_id": project.id,
                    "asset_id": asset.id,
                    "relative_path": asset.relative_path or asset.original_filename,
                    "image_width": asset.width,
                    "image_height": asset.height,
                    "frame_count": asset.frame_count,
                    "task_id": task.id,
                    "task_status": task.status.value,
                    "assigned_to": task.assigned_to,
                    "reviewer_id": task.reviewer_id,
                    "annotations": [serialize_annotation(annotation) for annotation in annotations_by_task[task.id]],
                }
                bundle.writestr(json.dumps(annotation_payload, ensure_ascii=False, indent=2).encode("utf-8"), annotation_path)
                manifest_items.append({
                    "asset_id": asset.id,
                    "task_id": task.id,
                    "task_status": task.status.value,
                    "relative_path": asset.relative_path or asset.original_filename,
                    "image_archive_path": image_path,
                    "annotation_archive_path": annotation_path,
                    "annotation_count": len(annotations_by_task[task.id]),
                })
            if schema:
                bundle.writestr(json.dumps({"version": schema.version, **schema.schema_json}, ensure_ascii=False, indent=2).encode("utf-8"), "labels/schema.json")
            manifest = {
                "format_version": 1,
                "project_id": project.id,
                "project_name": project.name,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "folder_structure_preserved": True,
                "items": manifest_items,
            }
            bundle.writestr(json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"), "manifest.json")
        return buffer.getvalue()

    def _require_project_access(self, actor: User, project_id: str) -> Project:
        if actor.role not in {Role.ADMINISTRATOR, Role.PROJECT_MANAGER}:
            raise HTTPException(403, "프로젝트 데이터 관리 권한이 없습니다.")
        project = self.db.get(Project, project_id)
        if project is None:
            raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")
        if actor.role != Role.ADMINISTRATOR and self.db.scalar(select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.user_id == actor.id)) is None:
            raise HTTPException(403, "이 프로젝트에 접근할 권한이 없습니다.")
        return project


def safe_archive_path(value: str) -> str:
    normalized = value.strip().replace("\\", "/")
    path = PurePosixPath(normalized)
    if not normalized or path.is_absolute() or any(part == ".." for part in path.parts):
        raise ValueError("Unsafe archive path")
    return path.as_posix()


def unique_archive_path(value: str, asset_id: str, used: set[str]) -> str:
    if value not in used:
        used.add(value)
        return value
    path = PurePosixPath(value)
    suffix = asset_id[:8]
    candidate = (path.parent / f"{path.stem}__{suffix}{path.suffix}").as_posix()
    index = 2
    while candidate in used:
        candidate = (path.parent / f"{path.stem}__{suffix}-{index}{path.suffix}").as_posix()
        index += 1
    used.add(candidate)
    return candidate


def serialize_annotation(annotation: Annotation) -> dict[str, object]:
    return {
        "annotation_id": annotation.id,
        "annotation_type": annotation.annotation_type,
        "label_id": annotation.label_id,
        "geometry": annotation.geometry_json,
        "attributes": annotation.attributes_json,
        "frame_index": annotation.frame_index,
        "source": annotation.source,
        "model_version": annotation.model_version,
        "confidence": annotation.confidence,
        "version": annotation.current_version,
    }
