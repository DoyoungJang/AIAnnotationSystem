"""Project, label schema, user and assignment operations."""
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.entities import AnnotationTask, Dataset, LabelSchemaVersion, MediaAsset, Project, ProjectMember, Role, TaskStatus, User
from app.schemas.api import LabelSchemaCreate, ProjectCreate, ProjectDeleteRequest, ProjectFolderUpdate, ProjectMemberCreate, ProjectPreviewSettings, TaskBatchCreate, TaskBatchReassign, TaskCreate, UserCreate, UserPasswordReset
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

    def reset_user_password(self, actor: User, user_id: str, payload: UserPasswordReset) -> User:
        if actor.role != Role.ADMINISTRATOR:
            raise HTTPException(403, "Sudo 관리자 권한이 필요합니다.")
        user = self.db.get(User, user_id)
        if user is None:
            raise HTTPException(404, "사용자를 찾을 수 없습니다.")
        user.password_hash = hash_password(payload.password)
        user.failed_login_count = 0
        if user.status == "LOCKED":
            user.status = "ACTIVE"
        self.audit.record(actor, "USER_PASSWORD_RESET", "user", user.id, None, "User password reset by administrator")
        self.db.commit()
        self.db.refresh(user)
        return user

    def list_members(self, actor: User, project_id: str) -> list[dict]:
        self.get_project(actor, project_id)
        if actor.role not in MANAGE_ROLES:
            raise HTTPException(403, "프로젝트 멤버를 조회할 권한이 없습니다.")
        rows = self.db.execute(
            select(ProjectMember, User)
            .join(User, User.id == ProjectMember.user_id)
            .where(ProjectMember.project_id == project_id)
            .order_by(User.display_name)
        ).all()
        return [{
            "id": member.id,
            "project_id": member.project_id,
            "user_id": user.id,
            "project_role": member.project_role,
            "username": user.username,
            "display_name": user.display_name,
        } for member, user in rows]

    def add_member(self, actor: User, project_id: str, payload: ProjectMemberCreate) -> dict:
        self.get_project(actor, project_id)
        if actor.role not in MANAGE_ROLES:
            raise HTTPException(403, "프로젝트 멤버를 지정할 권한이 없습니다.")
        user = self.db.get(User, payload.user_id)
        if user is None or user.status != "ACTIVE":
            raise HTTPException(404, "활성 사용자를 찾을 수 없습니다.")
        if user.role == Role.ADMINISTRATOR:
            raise HTTPException(422, "Sudo 관리자는 프로젝트 멤버로 지정할 필요가 없습니다.")
        if actor.role == Role.PROJECT_MANAGER and user.role == Role.PROJECT_MANAGER:
            raise HTTPException(403, "프로젝트 관리자는 다른 관리자를 지정할 수 없습니다.")
        member = self.db.scalar(select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user.id,
        ))
        if member is None:
            member = ProjectMember(project_id=project_id, user_id=user.id, project_role=user.role)
            self.db.add(member)
            self.db.flush()
            self.audit.record(actor, "PROJECT_MEMBER_ADDED", "project_member", member.id, project_id, f"Added {user.username} as {user.role.value}")
            self.db.commit()
        return {
            "id": member.id,
            "project_id": member.project_id,
            "user_id": user.id,
            "project_role": member.project_role,
            "username": user.username,
            "display_name": user.display_name,
        }

    def list_projects(self, actor: User) -> list[Project]:
        query = select(Project).where(Project.status != "DELETED").order_by(Project.updated_at.desc())
        if actor.role != Role.ADMINISTRATOR:
            query = query.join(ProjectMember).where(ProjectMember.user_id == actor.id)
        return list(self.db.scalars(query).all())

    def get_project(self, actor: User, project_id: str) -> Project:
        project = self.db.get(Project, project_id)
        if project is None or project.status == "DELETED":
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

    def update_preview_settings(self, actor: User, project_id: str, payload: ProjectPreviewSettings) -> Project:
        project = self.get_project(actor, project_id)
        if actor.role not in MANAGE_ROLES:
            raise HTTPException(403, "프로젝트 미리보기 설정 권한이 없습니다.")
        project.show_task_thumbnails = payload.show_task_thumbnails
        self.audit.record(
            actor,
            "PROJECT_PREVIEW_SETTINGS_UPDATED",
            "project",
            project.id,
            project.id,
            "Task thumbnails enabled" if payload.show_task_thumbnails else "Protected task placeholders enabled",
        )
        self.db.commit()
        self.db.refresh(project)
        return project

    def update_folder(self, actor: User, project_id: str, payload: ProjectFolderUpdate) -> Project:
        project = self.get_project(actor, project_id)
        if actor.role not in MANAGE_ROLES:
            raise HTTPException(403, "프로젝트 폴더 관리 권한이 없습니다.")
        project.folder_path = payload.folder_path
        self.audit.record(actor, "PROJECT_FOLDER_UPDATED", "project", project.id, project.id, f"Project folder changed to {payload.folder_path or 'root'}")
        self.db.commit()
        self.db.refresh(project)
        return project

    def delete_project(self, actor: User, project_id: str, payload: ProjectDeleteRequest) -> None:
        project = self.get_project(actor, project_id)
        if actor.role != Role.ADMINISTRATOR and not (actor.role == Role.PROJECT_MANAGER and project.created_by == actor.id):
            raise HTTPException(403, "프로젝트 삭제 권한이 없습니다.")
        if payload.project_name != project.name:
            raise HTTPException(422, "프로젝트 이름이 일치하지 않습니다.")
        project.status = "DELETED"
        self.audit.record(actor, "PROJECT_DELETED", "project", project.id, project.id, "Project logically deleted after exact-name confirmation")
        self.db.commit()

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

    def _prepare_assignment(self, actor: User, project_id: str, assigned_to: str | None, reviewer_id: str | None) -> None:
        self.get_project(actor, project_id)
        if actor.role not in MANAGE_ROLES:
            raise HTTPException(403, "작업 배정 권한이 없습니다.")
        assignee = self.db.get(User, assigned_to) if assigned_to else None
        reviewer = self.db.get(User, reviewer_id) if reviewer_id else None
        if assigned_to and (assignee is None or assignee.role not in {Role.ANNOTATOR, Role.ADMINISTRATOR}):
            raise HTTPException(422, "라벨러 역할의 사용자만 작업자로 배정할 수 있습니다.")
        if reviewer_id and (reviewer is None or reviewer.role not in {Role.REVIEWER, Role.ADMINISTRATOR}):
            raise HTTPException(422, "검수자 역할의 사용자만 검수자로 배정할 수 있습니다.")
        for user in (assignee, reviewer):
            if user is None or user.role == Role.ADMINISTRATOR:
                continue
            member = self.db.scalar(select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.user_id == user.id))
            if member is None:
                self.db.add(ProjectMember(project_id=project_id, user_id=user.id, project_role=user.role))

    def _build_task(self, project_id: str, payload: TaskCreate) -> AnnotationTask:
        asset = self.db.get(MediaAsset, payload.media_asset_id)
        if asset is None:
            raise HTTPException(404, "영상을 찾을 수 없습니다.")
        dataset = self.db.get(Dataset, asset.dataset_id)
        if dataset is None or dataset.project_id != project_id:
            raise HTTPException(422, "선택한 영상이 이 프로젝트에 속하지 않습니다.")
        task = AnnotationTask(project_id=project_id, media_asset_id=asset.id, assigned_to=payload.assigned_to, reviewer_id=payload.reviewer_id, priority=payload.priority, status=TaskStatus.ASSIGNED if payload.assigned_to else TaskStatus.UNASSIGNED)
        self.db.add(task)
        return task

    def create_task(self, actor: User, project_id: str, payload: TaskCreate) -> AnnotationTask:
        self._prepare_assignment(actor, project_id, payload.assigned_to, payload.reviewer_id)
        task = self._build_task(project_id, payload)
        self.db.flush()
        self.audit.record(actor, "TASK_CREATED", "task", task.id, project_id, "Annotation task created")
        self.db.commit()
        return task

    def create_tasks(self, actor: User, project_id: str, payload: TaskBatchCreate) -> list[AnnotationTask]:
        self._prepare_assignment(actor, project_id, payload.assigned_to, payload.reviewer_id)
        tasks: list[AnnotationTask] = []
        for asset_id in payload.media_asset_ids:
            task = self._build_task(project_id, TaskCreate(
                media_asset_id=asset_id,
                assigned_to=payload.assigned_to,
                reviewer_id=payload.reviewer_id,
                priority=payload.priority,
            ))
            self.db.flush()
            self.audit.record(actor, "TASK_CREATED", "task", task.id, project_id, "Annotation task created by batch assignment")
            tasks.append(task)
        self.db.commit()
        return tasks

    def reassign_tasks(self, actor: User, project_id: str, payload: TaskBatchReassign) -> list[AnnotationTask]:
        changes = payload.model_fields_set
        self._prepare_assignment(
            actor,
            project_id,
            payload.assigned_to if "assigned_to" in changes else None,
            payload.reviewer_id if "reviewer_id" in changes else None,
        )
        tasks: list[AnnotationTask] = []
        for task_id in payload.task_ids:
            task = self.db.get(AnnotationTask, task_id)
            if task is None:
                raise HTTPException(404, "변경할 작업을 찾을 수 없습니다.")
            if task.project_id != project_id:
                raise HTTPException(422, "선택한 작업이 이 프로젝트에 속하지 않습니다.")
            tasks.append(task)

        for task in tasks:
            if "assigned_to" in changes:
                assignee_changed = task.assigned_to != payload.assigned_to
                task.assigned_to = payload.assigned_to
                if assignee_changed:
                    task.lock_owner = None
                    task.lock_expires_at = None
                if task.status == TaskStatus.UNASSIGNED and payload.assigned_to:
                    task.status = TaskStatus.ASSIGNED
                elif task.status == TaskStatus.ASSIGNED and payload.assigned_to is None:
                    task.status = TaskStatus.UNASSIGNED
            if "reviewer_id" in changes:
                task.reviewer_id = payload.reviewer_id
            self.audit.record(actor, "TASK_REASSIGNED", "task", task.id, project_id, "Task assignee or reviewer updated")
        self.db.commit()
        return tasks
