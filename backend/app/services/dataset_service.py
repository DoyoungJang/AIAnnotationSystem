"""Safe image import, hierarchy creation and protected media access."""
import hashlib
import re
import uuid
from io import BytesIO
from pathlib import Path

from fastapi import HTTPException
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import hash_patient_id
from app.medical_io.readers import ImageReaderRegistry
from app.models.entities import Dataset, MediaAsset, Patient, Project, ProjectMember, Role, Series, Study, User
from app.services.audit_service import AuditService
from app.storage.local import LocalStorageProvider


class DatasetService:
    """Import validated images without modifying source bytes."""

    def __init__(self, db: Session, settings: Settings) -> None:
        self.db, self.settings = db, settings
        self.storage = LocalStorageProvider(settings.storage_root)
        self.readers = ImageReaderRegistry()
        self.audit = AuditService(db)

    def _require_manage(self, actor: User, project_id: str) -> Project:
        project = self.db.get(Project, project_id)
        if project is None or project.status == "DELETED":
            raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")
        if actor.role not in {Role.ADMINISTRATOR, Role.PROJECT_MANAGER}:
            raise HTTPException(403, "데이터셋 관리 권한이 없습니다.")
        if actor.role != Role.ADMINISTRATOR and self.db.scalar(select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.user_id == actor.id)) is None:
            raise HTTPException(403, "이 프로젝트에 접근할 권한이 없습니다.")
        return project

    def import_files(self, actor: User, project_id: str, dataset_name: str, files: list[tuple[str, str | None, bytes]], dataset_id: str | None = None) -> tuple[Dataset, list[MediaAsset], int]:
        self._require_manage(actor, project_id)
        if dataset_id:
            dataset = self.db.get(Dataset, dataset_id)
            if dataset is None or dataset.project_id != project_id:
                raise HTTPException(404, "Upload dataset not found in this project.")
        else:
            dataset = Dataset(project_id=project_id, name=dataset_name)
            self.db.add(dataset)
            self.db.flush()
        assets: list[MediaAsset] = []
        duplicates = 0
        for original_name, content_type, data in files:
            relative_path = normalize_relative_path(original_name)
            if len(data) > self.settings.max_upload_mb * 1024 * 1024:
                raise HTTPException(413, "업로드 파일 크기 제한을 초과했습니다.")
            suffix = Path(relative_path).suffix.lower()
            checksum = hashlib.sha256(data).hexdigest()
            if self.db.scalar(
                select(MediaAsset)
                .join(Dataset, MediaAsset.dataset_id == Dataset.id)
                .where(
                    Dataset.project_id == project_id,
                    MediaAsset.checksum == checksum,
                    MediaAsset.relative_path == relative_path,
                )
            ):
                duplicates += 1
                continue
            try:
                info = self.readers.read(suffix, data)
            except (ValueError, OSError) as error:
                raise HTTPException(422, str(error)) from error
            patient_hash = hash_patient_id(f"{project_id}:{info.patient_id}", self.settings.secret_key)
            patient = self.db.scalar(select(Patient).where(Patient.project_id == project_id, Patient.hashed_patient_id == patient_hash))
            if patient is None:
                patient = Patient(project_id=project_id, hashed_patient_id=patient_hash)
                self.db.add(patient); self.db.flush()
            study = self.db.scalar(select(Study).where(Study.patient_id == patient.id, Study.study_instance_uid == info.study_uid))
            if study is None:
                study = Study(patient_id=patient.id, study_instance_uid=info.study_uid, metadata_json={})
                self.db.add(study); self.db.flush()
            series = self.db.scalar(select(Series).where(Series.study_id == study.id, Series.series_instance_uid == info.series_uid))
            if series is None:
                series = Series(study_id=study.id, series_instance_uid=info.series_uid, manufacturer=info.manufacturer, device_model=info.device_model, frame_count=info.frame_count, metadata_json={})
                self.db.add(series); self.db.flush()
            opaque = str(uuid.uuid4())
            storage_key = f"originals/{project_id}/{opaque}{suffix}"
            thumbnail_key = f"thumbnails/{project_id}/{opaque}.png"
            thumbnail = info.preview.copy(); thumbnail.thumbnail((320, 320))
            buffer = BytesIO(); thumbnail.save(buffer, "PNG")
            self.storage.put(storage_key, data)
            self.storage.put(thumbnail_key, buffer.getvalue())
            asset = MediaAsset(dataset_id=dataset.id, series_id=series.id, sop_instance_uid=info.sop_uid, storage_key=storage_key, media_type=info.media_type, original_filename=Path(relative_path).name, relative_path=relative_path, width=info.width, height=info.height, frame_count=info.frame_count, checksum=checksum, thumbnail_key=thumbnail_key, phi_suspected=bool(info.phi_tags))
            self.db.add(asset); self.db.flush(); assets.append(asset)
        manifest_assets = list(self.db.scalars(select(MediaAsset).where(MediaAsset.dataset_id == dataset.id)).all())
        dataset.manifest_hash = hashlib.sha256("".join(sorted(f"{a.relative_path}\0{a.checksum}" for a in manifest_assets)).encode()).hexdigest()
        self.audit.record(actor, "DATASET_IMPORTED", "dataset", dataset.id, project_id, f"Imported {len(assets)} assets; {duplicates} duplicates skipped")
        self.db.commit()
        return dataset, assets, duplicates

    def list_assets(self, actor: User, dataset_id: str) -> list[MediaAsset]:
        dataset = self.db.get(Dataset, dataset_id)
        if dataset is None:
            raise HTTPException(404, "데이터셋을 찾을 수 없습니다.")
        self._require_access(actor, dataset.project_id)
        return list(self.db.scalars(select(MediaAsset).where(MediaAsset.dataset_id == dataset_id)).all())

    def _require_access(self, actor: User, project_id: str) -> None:
        project = self.db.get(Project, project_id)
        if project is None or project.status == "DELETED":
            raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")
        if actor.role != Role.ADMINISTRATOR and self.db.scalar(select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.user_id == actor.id)) is None:
            raise HTTPException(403, "이 프로젝트에 접근할 권한이 없습니다.")

    def get_asset(self, actor: User, asset_id: str) -> MediaAsset:
        asset = self.db.get(MediaAsset, asset_id)
        if asset is None:
            raise HTTPException(404, "영상을 찾을 수 없습니다.")
        dataset = self.db.get(Dataset, asset.dataset_id)
        if dataset is None:
            raise HTTPException(404, "데이터셋을 찾을 수 없습니다.")
        self._require_access(actor, dataset.project_id)
        return asset

    def asset_bytes(self, actor: User, asset_id: str, thumbnail: bool = False) -> tuple[bytes, str]:
        asset = self.get_asset(actor, asset_id)
        key = asset.thumbnail_key if thumbnail else asset.storage_key
        if key is None:
            raise HTTPException(404, "Thumbnail이 없습니다.")
        return self.storage.read(key), "image/png" if thumbnail else asset.media_type


def normalize_relative_path(value: str) -> str:
    """Validate and normalize a browser-supplied folder-relative file path."""
    raw = value.strip().replace("\\", "/")
    if not raw or raw.startswith("/") or re.match(r"^[A-Za-z]:", raw):
        raise HTTPException(422, "파일 상대 경로가 올바르지 않습니다.")
    cleaned: list[str] = []
    windows_reserved = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
    for raw_segment in raw.split("/"):
        segment = raw_segment.strip()
        if not segment or segment in {".", ".."} or segment.endswith("."):
            raise HTTPException(422, "파일 상대 경로가 올바르지 않습니다.")
        if len(segment) > 255 or re.search(r'[<>:"|?*\x00-\x1f]', segment) or segment.split(".")[0].upper() in windows_reserved:
            raise HTTPException(422, "파일 경로에 사용할 수 없는 문자가 있습니다.")
        cleaned.append(segment)
    normalized = "/".join(cleaned)
    if len(normalized) > 1000:
        raise HTTPException(422, "파일 상대 경로가 너무 깁니다.")
    return normalized
