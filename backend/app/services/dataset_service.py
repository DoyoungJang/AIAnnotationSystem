"""Safe image import, hierarchy creation and protected media access."""
import hashlib
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
        if project is None:
            raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")
        if actor.role not in {Role.ADMINISTRATOR, Role.PROJECT_MANAGER}:
            raise HTTPException(403, "데이터셋 관리 권한이 없습니다.")
        if actor.role != Role.ADMINISTRATOR and self.db.scalar(select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.user_id == actor.id)) is None:
            raise HTTPException(403, "이 프로젝트에 접근할 권한이 없습니다.")
        return project

    def import_files(self, actor: User, project_id: str, dataset_name: str, files: list[tuple[str, str | None, bytes]]) -> tuple[Dataset, list[MediaAsset], int]:
        self._require_manage(actor, project_id)
        dataset = Dataset(project_id=project_id, name=dataset_name)
        self.db.add(dataset)
        self.db.flush()
        assets: list[MediaAsset] = []
        duplicates = 0
        for original_name, content_type, data in files:
            if len(data) > self.settings.max_upload_mb * 1024 * 1024:
                raise HTTPException(413, "업로드 파일 크기 제한을 초과했습니다.")
            suffix = Path(original_name).suffix.lower()
            checksum = hashlib.sha256(data).hexdigest()
            if self.db.scalar(select(MediaAsset).where(MediaAsset.checksum == checksum)):
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
            asset = MediaAsset(dataset_id=dataset.id, series_id=series.id, sop_instance_uid=info.sop_uid, storage_key=storage_key, media_type=info.media_type, original_filename=Path(original_name).name, width=info.width, height=info.height, frame_count=info.frame_count, checksum=checksum, thumbnail_key=thumbnail_key, phi_suspected=bool(info.phi_tags))
            self.db.add(asset); self.db.flush(); assets.append(asset)
        dataset.manifest_hash = hashlib.sha256("".join(sorted(a.checksum for a in assets)).encode()).hexdigest()
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
