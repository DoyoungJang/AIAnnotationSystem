"""Review state transitions that preserve approved history."""
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.entities import AnnotationTask, Review, Role, TaskStatus, User
from app.schemas.api import ReviewRequest
from app.services.audit_service import AuditService


class ReviewService:
    """Approve or request corrections for submitted tasks."""

    def __init__(self, db: Session) -> None:
        self.db, self.audit = db, AuditService(db)

    def review(self, actor: User, task_id: str, payload: ReviewRequest) -> AnnotationTask:
        task = self.db.get(AnnotationTask, task_id)
        if task is None:
            raise HTTPException(404, "작업을 찾을 수 없습니다.")
        if actor.role not in {Role.ADMINISTRATOR, Role.PROJECT_MANAGER, Role.REVIEWER} or (actor.role == Role.REVIEWER and task.reviewer_id != actor.id):
            raise HTTPException(403, "검수 권한이 없습니다.")
        if task.status not in {TaskStatus.SUBMITTED, TaskStatus.IN_REVIEW}:
            raise HTTPException(409, "제출된 작업만 검수할 수 있습니다.")
        task.status = TaskStatus(payload.decision)
        self.db.add(Review(task_id=task.id, reviewer_id=actor.id, decision=payload.decision, comment=payload.comment))
        self.audit.record(actor, "TASK_REVIEWED", "task", task.id, task.project_id, f"Review decision: {payload.decision}")
        self.db.commit()
        return task
