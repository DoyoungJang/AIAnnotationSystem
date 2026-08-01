"""PHI-safe audit event recording."""
from sqlalchemy.orm import Session

from app.models.entities import AuditLog, User


class AuditService:
    """Record bounded summaries without medical payloads."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def record(self, actor: User, event_type: str, resource_type: str, resource_id: str, project_id: str | None, summary: str) -> None:
        self.db.add(AuditLog(event_type=event_type, actor_id=actor.id, project_id=project_id, resource_type=resource_type, resource_id=resource_id, summary=summary[:255], success=True))
