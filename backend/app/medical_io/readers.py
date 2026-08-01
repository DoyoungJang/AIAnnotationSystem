"""Raster and DICOM readers behind one image contract."""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from io import BytesIO
from typing import Any

import numpy as np
import pydicom
from PIL import Image


@dataclass(frozen=True)
class ImageInfo:
    """Safe metadata and first-frame preview."""
    width: int
    height: int
    frame_count: int
    media_type: str
    preview: Image.Image
    patient_id: str
    study_uid: str
    series_uid: str
    sop_uid: str | None = None
    manufacturer: str | None = None
    device_model: str | None = None
    phi_tags: list[str] = field(default_factory=list)


class BaseImageReader(ABC):
    """Decode enough content to validate and thumbnail a file."""

    @abstractmethod
    def supports(self, suffix: str) -> bool: ...

    @abstractmethod
    def read(self, data: bytes) -> ImageInfo: ...


class RasterImageReader(BaseImageReader):
    """Read lossless/lossy two-dimensional raster files."""
    suffixes = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}

    def supports(self, suffix: str) -> bool:
        return suffix.lower() in self.suffixes

    def read(self, data: bytes) -> ImageInfo:
        image = Image.open(BytesIO(data))
        image.verify()
        source = Image.open(BytesIO(data))
        media_type = Image.MIME.get(source.format or "", "application/octet-stream")
        image = source.convert("L")
        if image.width < 16 or image.height < 16:
            raise ValueError("영상 해상도가 너무 작습니다.")
        return ImageInfo(image.width, image.height, 1, media_type, image, "RASTER", "RASTER-STUDY", "RASTER-SERIES")


class DicomImageReader(BaseImageReader):
    """Read DICOM metadata and lazily decode the first preview frame."""
    phi_keywords = ["PatientName", "PatientID", "PatientBirthDate", "PatientAddress", "InstitutionName", "ReferringPhysicianName", "AccessionNumber", "StudyDescription", "SeriesDescription", "OperatorsName"]

    def supports(self, suffix: str) -> bool:
        return suffix.lower() in {".dcm", ".dicom"}

    def read(self, data: bytes) -> ImageInfo:
        dataset = pydicom.dcmread(BytesIO(data), force=False)
        if "PixelData" not in dataset:
            raise ValueError("DICOM Pixel Data를 읽을 수 없습니다.")
        pixels = dataset.pixel_array
        frame_count = int(getattr(dataset, "NumberOfFrames", 1))
        frame = pixels[0] if frame_count > 1 else pixels
        if frame.ndim == 3 and frame.shape[-1] in (3, 4):
            image = Image.fromarray(frame.astype("uint8")).convert("L")
        else:
            values = frame.astype("float32")
            span = float(values.max() - values.min())
            normalized = np.zeros_like(values, dtype="uint8") if span == 0 else ((values - values.min()) / span * 255).astype("uint8")
            image = Image.fromarray(normalized).convert("L")
        phi = [keyword for keyword in self.phi_keywords if str(getattr(dataset, keyword, "")).strip()]
        return ImageInfo(
            int(dataset.Columns), int(dataset.Rows), frame_count, "application/dicom", image,
            str(getattr(dataset, "PatientID", "UNKNOWN")), str(getattr(dataset, "StudyInstanceUID", "UNKNOWN-STUDY")),
            str(getattr(dataset, "SeriesInstanceUID", "UNKNOWN-SERIES")), str(getattr(dataset, "SOPInstanceUID", "")) or None,
            str(getattr(dataset, "Manufacturer", "")) or None, str(getattr(dataset, "ManufacturerModelName", "")) or None, phi,
        )


class ImageReaderRegistry:
    """Select a replaceable image reader by suffix."""

    def __init__(self) -> None:
        self.readers: list[BaseImageReader] = [RasterImageReader(), DicomImageReader()]

    def read(self, suffix: str, data: bytes) -> ImageInfo:
        for reader in self.readers:
            if reader.supports(suffix):
                return reader.read(data)
        raise ValueError("지원하지 않는 파일 형식입니다.")
