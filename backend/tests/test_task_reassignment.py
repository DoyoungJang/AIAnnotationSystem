"""Existing task assignee and reviewer updates."""

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.models.entities import AnnotationTask, Project, Role, TaskStatus, User
from app.schemas.api import TaskBatchReassign
from app.services.project_service import ProjectService


def test_reassign_existing_task_preserves_unspecified_roles() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as db:
        admin = User(username="admin", display_name="Admin", role=Role.ADMINISTRATOR, password_hash="x")
        first = User(username="first", display_name="First", role=Role.ANNOTATOR, password_hash="x")
        second = User(username="second", display_name="Second", role=Role.ANNOTATOR, password_hash="x")
        reviewer = User(username="reviewer", display_name="Reviewer", role=Role.REVIEWER, password_hash="x")
        db.add_all([admin, first, second, reviewer]); db.flush()
        project = Project(name="Project", task_types=["bbox"], created_by=admin.id)
        db.add(project); db.flush()
        task = AnnotationTask(project_id=project.id, media_asset_id="asset", assigned_to=first.id, status=TaskStatus.ASSIGNED)
        db.add(task); db.commit()

        ProjectService(db).reassign_tasks(admin, project.id, TaskBatchReassign(task_ids=[task.id], reviewer_id=reviewer.id))
        assert task.assigned_to == first.id
        assert task.reviewer_id == reviewer.id

        ProjectService(db).reassign_tasks(admin, project.id, TaskBatchReassign(task_ids=[task.id], assigned_to=second.id))
        assert task.assigned_to == second.id
        assert task.reviewer_id == reviewer.id
