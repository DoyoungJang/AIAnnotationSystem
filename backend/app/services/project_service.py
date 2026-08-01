"""Project, label schema, user and assignment operations."""
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.entities import AnnotationTask, LabelSchemaVersion, MediaAsset, Project, ProjectMember, Role, TaskStatus, User
from app.schemas.api import LabelSchemaCreate, ProjectCreate, TaskCreate, UserCreate
from app.services.audit_service import AuditService


MANAGE_ROLES = {Role.ADMINISTRATOR, Role.PROJECT_MANAGER}


class ProjectService:
    """Manage projects and their immutable label schema versions."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.audit = AuditService(db)

    def create_user(self, actor: User, payload: UserCreate) -> User:
        if actor.role != Role.ADMINISTRATOR:
            raise HTTPException(403, "관리자 권한이 필요합니다.")
        if self.db.scalar(select(User).where(User.username == payload.username)):
            raise HTTPException(409, "이미 존재하는 사용자입니다.")
        user = User(username=payload.username, display_name=payload.display_name, role=payload.role, password_hash=hash_password(payload.password))
        self.db.add(user)
        self.db.flush()
        self.audit.record(actor, "USER_CREATED", "user", user.id, None, "User account created")
        self.db.commit()
        return user

    def list_projects(self, actor: User) -> list[Project]:
        query = select(Project).order_by(Project.updated_at.desc())
        if actor.role != Role.ADMINISTRATOR:
            query = query.join(ProjectMember).where(ProjectMember.user_id == actor.id)
        return list(self.db.scalars(query).all())

    def get_project(self, actor: User, project_id: str) -> Project:
        project = self.db.get(Project, project_id)
        if project is None:
            raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")
        if actor.role != Role.ADMINISTRATOR and self.db.scalar(select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.user_id == actor.id)) is None:
            raise HTTPException(403, "이 프로젝트에 접근할 권한이 없습니다.")
        return project

    def create_project(self, actor: User, payload: ProjectCreate) -> Project:
        if actor.role not in MANAGE_ROLES:
            raise HTTPException(403, "프로젝트 생성 권한이 없습니다.")
        project = Project(**payload.model_dump(), created_by=actor.id)
        self.db.add(project)
        self.db.flush()
        self.db.add(ProjectMember(project_id=project.id, user_id=actor.id, project_role=actor.role))
        self.audit.record(actor, "PROJECT_CREATED", "project", project.id, project.id, "Project created")
        self.db.commit()
        return project

    def create_schema(self, actor: User, project_id: str, payload: LabelSchemaCreate) -> LabelSchemaVersion:
        self.get_project(actor, project_id)
        if actor.role not in MANAGE_ROLES:
            raise HTTPException(403, "라벨 스키마 관리 권한이 없습니다.")
        current = self.db.scalar(select(func.max(LabelSchemaVersion.version)).where(LabelSchemaVersion.project_id == project_id)) or 0
        schema = LabelSchemaVersion(project_id=project_id, version=current + 1, schema_json={"labels": [label.model_dump() for label in payload.labels]}, status=payload.status, created_by=actor.id)
        self.db.add(schema)
        self.db.flush()
        self.audit.record(actor, "LABEL_SCHEMA_CREATED", "label_schema", schema.id, project_id, f"Label schema version {schema.version} created")
        self.db.commit()
        return schema

    def list_schemas(self, actor: User, project_id: str) -> list[LabelSchemaVersion]:
        self.get_project(actor, project_id)
        return list(self.db.scalars(select(LabelSchemaVersion).where(LabelSchemaVersion.project_id == project_id).order_by(LabelSchemaVersion.version.desc())).all())

    def create_task(self, actor: User, project_id: str, payload: TaskCreate) -> AnnotationTask:
        self.get_project(actor, project_id)
        if actor.role not in MANAGE_ROLES:
            raise HTTPException(403, "작업 배정 권한이 없습니다.")
        asset = self.db.get(MediaAsset, payload.media_asset_id)
        if asset is None:
            raise HTTPException(404, "영상을 찾을 수 없습니다.")
        task = AnnotationTask(project_id=project_id, media_asset_id=asset.id, assigned_to=payload.assigned_to, reviewer_id=payload.reviewer_id, priority=payload.priority, status=TaskStatus.ASSIGNED if payload.assigned_to else TaskStatus.UNASSIGNED)
        self.db.add(task)
        for user_id in {payload.assigned_to, payload.reviewer_id} - {None}:
            member = self.db.scalar(select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id))
            user = self.db.get(User, user_id)
            if user is None:
                raise HTTPException(422, "배정할 사용자를 찾을 수 없습니다.")
            if member is None:
                self.db.add(ProjectMember(project_id=project_id, user_id=user.id, project_role=user.role))
        self.db.flush()
        self.audit.record(actor, "TASK_CREATED", "task", task.id, project_id, "Annotation task created")
        self.db.commit()
        return task
