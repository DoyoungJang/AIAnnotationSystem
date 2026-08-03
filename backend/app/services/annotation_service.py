"""Task lease, optimistic saving and immutable annotation history."""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.annotations.handlers import AnnotationHandlerRegistry
from app.core.config import Settings
from app.models.entities import Annotation, AnnotationTask, AnnotationVersion, IdempotencyRecord, MediaAsset, Project, Role, TaskStatus, User
from app.schemas.api import AnnotationSaveRequest, TaskListOut, TaskOut
from app.services.audit_service import AuditService


EDITABLE = {TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS, TaskStatus.DRAFT, TaskStatus.SUBMITTED, TaskStatus.CHANGES_REQUESTED}


class AnnotationService:
    """Coordinate task ownership, versions and workflow-safe updates."""

    def __init__(self, db: Session, settings: Settings) -> None:
        self.db, self.settings = db, settings
        self.audit = AuditService(db)
        self.handlers = AnnotationHandlerRegistry()

    def _task(self, actor: User, task_id: str, require_edit: bool = False) -> AnnotationTask:
        task = self.db.get(AnnotationTask, task_id)
        if task is None:
            raise HTTPException(404, "작업을 찾을 수 없습니다.")
        privileged = actor.role in {Role.ADMINISTRATOR, Role.PROJECT_MANAGER}
        involved = actor.id in {task.assigned_to, task.reviewer_id}
        if not privileged and not involved:
            raise HTTPException(403, "이 작업에 접근할 권한이 없습니다.")
        if require_edit and task.assigned_to != actor.id and not privileged:
            raise HTTPException(403, "이 작업을 수정할 권한이 없습니다.")
        return task

    def my_tasks(self, actor: User) -> list[TaskListOut]:
        query = (
            select(AnnotationTask, Project.name, MediaAsset.original_filename, MediaAsset.relative_path)
            .join(Project, Project.id == AnnotationTask.project_id)
            .join(MediaAsset, MediaAsset.id == AnnotationTask.media_asset_id)
            .order_by(AnnotationTask.priority.desc(), AnnotationTask.updated_at.desc())
        )
        if actor.role == Role.ANNOTATOR:
            query = query.where(AnnotationTask.assigned_to == actor.id, AnnotationTask.status != TaskStatus.APPROVED)
        elif actor.role == Role.REVIEWER:
            query = query.where(AnnotationTask.reviewer_id == actor.id)
        return [
            TaskListOut(
                **TaskOut.model_validate(task).model_dump(),
                project_name=project_name,
                media_asset_original_filename=original_filename,
                media_asset_relative_path=relative_path or original_filename,
            )
            for task, project_name, original_filename, relative_path in self.db.execute(query).all()
        ]

    def acquire_lock(self, actor: User, task_id: str) -> AnnotationTask:
        task = self._task(actor, task_id, True)
        now = datetime.now(timezone.utc)
        expires = task.lock_expires_at
        if expires is not None and expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if task.lock_owner and task.lock_owner != actor.id and expires and expires > now:
            raise HTTPException(423, "다른 사용자가 현재 이 작업을 수정하고 있습니다.")
        if task.status not in EDITABLE:
            raise HTTPException(409, "현재 상태의 작업은 수정할 수 없습니다.")
        task.lock_owner = actor.id
        task.lock_expires_at = now + timedelta(seconds=self.settings.lock_ttl_seconds)
        if task.status in {TaskStatus.ASSIGNED, TaskStatus.SUBMITTED, TaskStatus.CHANGES_REQUESTED}:
            task.status = TaskStatus.IN_PROGRESS
        self.db.commit()
        return task

    def heartbeat(self, actor: User, task_id: str) -> AnnotationTask:
        task = self._task(actor, task_id, True)
        if task.lock_owner != actor.id:
            raise HTTPException(409, "현재 사용자가 보유한 작업 잠금이 없습니다.")
        task.lock_expires_at = datetime.now(timezone.utc) + timedelta(seconds=self.settings.lock_ttl_seconds)
        self.db.commit()
        return task

    def release_lock(self, actor: User, task_id: str) -> None:
        task = self._task(actor, task_id, True)
        if task.lock_owner == actor.id or actor.role in {Role.ADMINISTRATOR, Role.PROJECT_MANAGER}:
            task.lock_owner = None; task.lock_expires_at = None; self.db.commit()

    def list_annotations(self, actor: User, task_id: str) -> tuple[AnnotationTask, list[Annotation]]:
        task = self._task(actor, task_id)
        annotations = list(self.db.scalars(select(Annotation).where(Annotation.task_id == task_id, Annotation.deleted.is_(False))).all())
        return task, annotations

    @staticmethod
    def _snapshot(annotation: Annotation) -> dict[str, object]:
        return {"annotation_id": annotation.id, "annotation_type": annotation.annotation_type, "label_id": annotation.label_id, "geometry": annotation.geometry_json, "attributes": annotation.attributes_json, "frame_index": annotation.frame_index, "source": annotation.source, "model_version": annotation.model_version, "confidence": annotation.confidence, "deleted": annotation.deleted}

    def save(self, actor: User, task_id: str, payload: AnnotationSaveRequest, idempotency_key: str | None) -> tuple[AnnotationTask, list[Annotation]]:
        task = self._task(actor, task_id, True)
        if idempotency_key:
            record = self.db.scalar(select(IdempotencyRecord).where(IdempotencyRecord.user_id == actor.id, IdempotencyRecord.key == idempotency_key))
            if record:
                return self.list_annotations(actor, task_id)
        if task.aggregate_version != payload.client_version:
            raise HTTPException(409, detail={"message": "저장 중 버전 충돌이 발생했습니다.", "server_version": task.aggregate_version})
        now = datetime.now(timezone.utc)
        expires = task.lock_expires_at
        if expires is not None and expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if task.lock_owner != actor.id or expires is None or expires <= now:
            raise HTTPException(423, "작업 잠금을 획득하거나 갱신해 주세요.")
        existing = {item.id: item for item in self.db.scalars(select(Annotation).where(Annotation.task_id == task_id)).all()}
        for item in payload.annotations:
            annotation = existing.get(item.annotation_id or "")
            if annotation is None:
                annotation = Annotation(id=item.annotation_id or None, task_id=task_id, annotation_type=item.annotation_type, label_id=item.label_id, geometry_json={}, attributes_json={}, frame_index=item.frame_index, source=item.source, model_version=item.model_version, confidence=item.confidence, created_by=actor.id)
                if annotation.id is None:
                    from app.models.entities import new_id
                    annotation.id = new_id()
                self.db.add(annotation)
            else:
                annotation.current_version += 1
            annotation.annotation_type = item.annotation_type
            annotation.label_id = item.label_id
            annotation.geometry_json = self.handlers.get(item.annotation_type).normalize(item.geometry)
            annotation.attributes_json = item.attributes
            annotation.frame_index = item.frame_index
            annotation.source = item.source
            annotation.model_version = item.model_version
            annotation.confidence = item.confidence
            annotation.deleted = False
            self.db.flush()
            self.db.add(AnnotationVersion(annotation_id=annotation.id, version=annotation.current_version, snapshot_json=self._snapshot(annotation), change_reason=payload.change_reason, created_by=actor.id))
        for annotation_id in payload.deleted_annotation_ids:
            annotation = existing.get(annotation_id)
            if annotation and not annotation.deleted:
                annotation.deleted = True; annotation.current_version += 1
                self.db.add(AnnotationVersion(annotation_id=annotation.id, version=annotation.current_version, snapshot_json=self._snapshot(annotation), change_reason=payload.change_reason, created_by=actor.id))
        task.aggregate_version += 1
        task.status = TaskStatus.DRAFT
        if idempotency_key:
            self.db.add(IdempotencyRecord(user_id=actor.id, key=idempotency_key, task_id=task.id, result_version=task.aggregate_version))
        self.audit.record(actor, "ANNOTATIONS_SAVED", "task", task.id, task.project_id, f"Annotation aggregate version {task.aggregate_version} saved")
        self.db.commit()
        return self.list_annotations(actor, task_id)

    def submit(self, actor: User, task_id: str) -> AnnotationTask:
        task = self._task(actor, task_id, True)
        count = len(self.list_annotations(actor, task_id)[1])
        if count == 0:
            raise HTTPException(422, "필수 라벨이 입력되지 않았습니다.")
        if task.status not in EDITABLE:
            raise HTTPException(409, "현재 상태의 작업은 제출할 수 없습니다.")
        task.status = TaskStatus.SUBMITTED
        task.lock_owner = None; task.lock_expires_at = None
        self.audit.record(actor, "TASK_SUBMITTED", "task", task.id, task.project_id, "Task submitted for review")
        self.db.commit()
        return task

    def versions(self, actor: User, task_id: str) -> list[AnnotationVersion]:
        self._task(actor, task_id)
        return list(self.db.scalars(select(AnnotationVersion).join(Annotation).where(Annotation.task_id == task_id).order_by(AnnotationVersion.created_at.desc())).all())
