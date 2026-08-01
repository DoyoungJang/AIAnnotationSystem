"""Versioned HTTP endpoints with thin routing logic."""
from io import BytesIO

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import current_user, require_roles
from app.core.config import Settings, get_settings
from app.core.security import create_access_token, verify_password
from app.db import get_db
from app.models.entities import Annotation, AnnotationTask, AuditLog, Dataset, MediaAsset, Role, TaskStatus, User, utcnow
from app.schemas.api import *
from app.services.annotation_service import AnnotationService
from app.services.dataset_service import DatasetService
from app.services.export_service import ExportService
from app.services.project_service import ProjectService
from app.services.review_service import ReviewService

router = APIRouter(prefix="/api/v1")


@router.post("/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)) -> TokenResponse:
    user = db.scalar(select(User).where(User.username == payload.username))
    if user is None or user.status != "ACTIVE" or not verify_password(payload.password, user.password_hash):
        if user:
            user.failed_login_count += 1
            if user.failed_login_count >= 5: user.status = "LOCKED"
            db.commit()
        raise HTTPException(401, "아이디 또는 비밀번호가 올바르지 않습니다.")
    user.failed_login_count = 0; user.last_login_at = utcnow(); db.commit()
    return TokenResponse(access_token=create_access_token(user.id, settings.secret_key, settings.access_token_minutes))


@router.post("/auth/logout", status_code=204)
def logout(user: User = Depends(current_user)) -> Response:
    return Response(status_code=204)


@router.get("/users/me", response_model=UserOut)
def me(user: User = Depends(current_user)) -> User: return user


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(payload: UserCreate, db: Session = Depends(get_db), actor: User = Depends(current_user)) -> User:
    return ProjectService(db).create_user(actor, payload)


@router.get("/users", response_model=list[UserOut])
def users(db: Session = Depends(get_db), actor: User = Depends(require_roles(Role.ADMINISTRATOR, Role.PROJECT_MANAGER))) -> list[User]:
    query = select(User).order_by(User.display_name)
    if actor.role == Role.PROJECT_MANAGER:
        query = query.where(User.role.in_([Role.ANNOTATOR, Role.REVIEWER, Role.OBSERVER]))
    return list(db.scalars(query).all())


@router.get("/projects", response_model=list[ProjectOut])
def projects(db: Session = Depends(get_db), actor: User = Depends(current_user)) -> list: return ProjectService(db).list_projects(actor)


@router.post("/projects", response_model=ProjectOut, status_code=201)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db), actor: User = Depends(current_user)): return ProjectService(db).create_project(actor, payload)


@router.get("/projects/{project_id}", response_model=ProjectOut)
def project(project_id: str, db: Session = Depends(get_db), actor: User = Depends(current_user)): return ProjectService(db).get_project(actor, project_id)


@router.get("/projects/{project_id}/members", response_model=list[ProjectMemberOut])
def project_members(project_id: str, db: Session = Depends(get_db), actor: User = Depends(current_user)):
    return ProjectService(db).list_members(actor, project_id)


@router.post("/projects/{project_id}/members", response_model=ProjectMemberOut, status_code=201)
def add_project_member(project_id: str, payload: ProjectMemberCreate, db: Session = Depends(get_db), actor: User = Depends(current_user)):
    return ProjectService(db).add_member(actor, project_id, payload)


@router.post("/projects/{project_id}/label-schemas", response_model=LabelSchemaOut, status_code=201)
def create_schema(project_id: str, payload: LabelSchemaCreate, db: Session = Depends(get_db), actor: User = Depends(current_user)): return ProjectService(db).create_schema(actor, project_id, payload)


@router.get("/projects/{project_id}/label-schemas", response_model=list[LabelSchemaOut])
def schemas(project_id: str, db: Session = Depends(get_db), actor: User = Depends(current_user)): return ProjectService(db).list_schemas(actor, project_id)


@router.post("/projects/{project_id}/datasets/import", response_model=ImportOut, status_code=201)
def import_dataset(project_id: str, dataset_name: str = Form(...), files: list[UploadFile] = File(...), db: Session = Depends(get_db), settings: Settings = Depends(get_settings), actor: User = Depends(current_user)):
    values = [(file.filename or "upload", file.content_type, file.file.read()) for file in files]
    dataset, assets, duplicate_count = DatasetService(db, settings).import_files(actor, project_id, dataset_name, values)
    return ImportOut(dataset_id=dataset.id, assets=assets, duplicate_count=duplicate_count)


@router.get("/datasets/{dataset_id}/assets", response_model=list[AssetOut])
def assets(dataset_id: str, db: Session = Depends(get_db), settings: Settings = Depends(get_settings), actor: User = Depends(current_user)): return DatasetService(db, settings).list_assets(actor, dataset_id)


@router.get("/projects/{project_id}/datasets", response_model=list[DatasetOut])
def datasets(project_id: str, db: Session = Depends(get_db), actor: User = Depends(current_user)):
    ProjectService(db).get_project(actor, project_id)
    return list(db.scalars(select(Dataset).where(Dataset.project_id == project_id).order_by(Dataset.created_at.desc())).all())


@router.get("/assets/{asset_id}", response_model=AssetOut)
def asset(asset_id: str, db: Session = Depends(get_db), settings: Settings = Depends(get_settings), actor: User = Depends(current_user)):
    return DatasetService(db, settings).get_asset(actor, asset_id)


@router.get("/assets/{asset_id}/content")
def asset_content(asset_id: str, frame: int = 0, db: Session = Depends(get_db), settings: Settings = Depends(get_settings), actor: User = Depends(current_user)):
    data, media_type = DatasetService(db, settings).asset_bytes(actor, asset_id)
    if media_type == "application/dicom":
        try:
            from app.medical_io.readers import DicomImageReader
            image = DicomImageReader().read(data).preview; output = BytesIO(); image.save(output, "PNG"); data, media_type = output.getvalue(), "image/png"
        except (ValueError, OSError) as error: raise HTTPException(422, "DICOM Pixel Data를 읽을 수 없습니다.") from error
    return Response(data, media_type=media_type, headers={"Cache-Control": "private, max-age=60"})


@router.get("/assets/{asset_id}/thumbnail")
def thumbnail(asset_id: str, db: Session = Depends(get_db), settings: Settings = Depends(get_settings), actor: User = Depends(current_user)):
    data, media_type = DatasetService(db, settings).asset_bytes(actor, asset_id, True); return Response(data, media_type=media_type, headers={"Cache-Control": "private, max-age=300"})


@router.post("/projects/{project_id}/tasks", response_model=TaskOut, status_code=201)
def create_task(project_id: str, payload: TaskCreate, db: Session = Depends(get_db), actor: User = Depends(current_user)): return ProjectService(db).create_task(actor, project_id, payload)


@router.get("/tasks/my", response_model=list[TaskOut])
def my_tasks(db: Session = Depends(get_db), settings: Settings = Depends(get_settings), actor: User = Depends(current_user)): return AnnotationService(db, settings).my_tasks(actor)


@router.post("/tasks/{task_id}/lock", response_model=TaskOut)
def lock(task_id: str, db: Session = Depends(get_db), settings: Settings = Depends(get_settings), actor: User = Depends(current_user)): return AnnotationService(db, settings).acquire_lock(actor, task_id)


@router.post("/tasks/{task_id}/heartbeat", response_model=TaskOut)
def heartbeat(task_id: str, db: Session = Depends(get_db), settings: Settings = Depends(get_settings), actor: User = Depends(current_user)): return AnnotationService(db, settings).heartbeat(actor, task_id)


@router.delete("/tasks/{task_id}/lock", status_code=204)
def unlock(task_id: str, db: Session = Depends(get_db), settings: Settings = Depends(get_settings), actor: User = Depends(current_user)):
    AnnotationService(db, settings).release_lock(actor, task_id); return Response(status_code=204)


@router.get("/tasks/{task_id}/annotations", response_model=AnnotationSaveResponse)
def annotations(task_id: str, db: Session = Depends(get_db), settings: Settings = Depends(get_settings), actor: User = Depends(current_user)):
    task, values = AnnotationService(db, settings).list_annotations(actor, task_id); return AnnotationSaveResponse(aggregate_version=task.aggregate_version, annotations=values)


@router.put("/tasks/{task_id}/annotations", response_model=AnnotationSaveResponse)
def save_annotations(task_id: str, payload: AnnotationSaveRequest, idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"), db: Session = Depends(get_db), settings: Settings = Depends(get_settings), actor: User = Depends(current_user)):
    task, values = AnnotationService(db, settings).save(actor, task_id, payload, idempotency_key); return AnnotationSaveResponse(aggregate_version=task.aggregate_version, annotations=values)


@router.post("/tasks/{task_id}/submit", response_model=TaskOut)
def submit(task_id: str, db: Session = Depends(get_db), settings: Settings = Depends(get_settings), actor: User = Depends(current_user)): return AnnotationService(db, settings).submit(actor, task_id)


@router.post("/tasks/{task_id}/review", response_model=TaskOut)
def review(task_id: str, payload: ReviewRequest, db: Session = Depends(get_db), actor: User = Depends(current_user)): return ReviewService(db).review(actor, task_id, payload)


@router.get("/tasks/{task_id}/versions")
def versions(task_id: str, db: Session = Depends(get_db), settings: Settings = Depends(get_settings), actor: User = Depends(current_user)):
    return [{"annotation_id": value.annotation_id, "version": value.version, "snapshot": value.snapshot_json, "change_reason": value.change_reason, "created_at": value.created_at} for value in AnnotationService(db, settings).versions(actor, task_id)]


@router.post("/projects/{project_id}/exports", response_model=ExportOut, status_code=201)
def create_export(project_id: str, payload: ExportRequest, db: Session = Depends(get_db), settings: Settings = Depends(get_settings), actor: User = Depends(current_user)): return ExportService(db, settings).create(actor, project_id, payload.format)


@router.get("/exports/{export_id}", response_model=ExportOut)
def export(export_id: str, db: Session = Depends(get_db), settings: Settings = Depends(get_settings), actor: User = Depends(current_user)): return ExportService(db, settings).get(actor, export_id)


@router.get("/exports/{export_id}/download")
def download_export(export_id: str, db: Session = Depends(get_db), settings: Settings = Depends(get_settings), actor: User = Depends(current_user)):
    return Response(ExportService(db, settings).download(actor, export_id), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="sonolabel-{export_id}.zip"'})


@router.get("/projects/{project_id}/statistics", response_model=StatisticsOut)
def statistics(project_id: str, db: Session = Depends(get_db), actor: User = Depends(current_user)):
    ProjectService(db).get_project(actor, project_id)
    statuses = db.execute(select(AnnotationTask.status, func.count()).where(AnnotationTask.project_id == project_id).group_by(AnnotationTask.status)).all()
    approved = db.scalar(select(func.count(Annotation.id)).join(AnnotationTask).where(AnnotationTask.project_id == project_id, AnnotationTask.status == TaskStatus.APPROVED, Annotation.deleted.is_(False))) or 0
    mapped = {status.value: count for status, count in statuses}; return StatisticsOut(total_tasks=sum(mapped.values()), by_status=mapped, approved_annotations=approved)


@router.get("/audit-logs")
def audit_logs(db: Session = Depends(get_db), actor: User = Depends(require_roles(Role.ADMINISTRATOR))):
    return list(db.scalars(select(AuditLog).order_by(AuditLog.timestamp.desc()).limit(500)).all())
