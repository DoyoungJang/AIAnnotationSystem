"""Validated request and response contracts."""
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.entities import Role, TaskStatus


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=8, max_length=256)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(ORMModel):
    id: str
    username: str
    display_name: str
    role: Role
    status: str


class UserCreate(BaseModel):
    username: str = Field(pattern=r"^[a-zA-Z0-9_.-]+$", max_length=80)
    display_name: str = Field(min_length=1, max_length=120)
    role: Role
    password: str = Field(min_length=12, max_length=256)


class ProjectMemberCreate(BaseModel):
    user_id: str


class ProjectMemberOut(BaseModel):
    id: str
    project_id: str
    user_id: str
    project_role: Role
    username: str
    display_name: str


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=4000)
    task_types: list[Literal["classification", "bbox", "polygon", "brush"]] = Field(default_factory=list)


class ProjectOut(ORMModel):
    id: str
    name: str
    description: str
    task_types: list[str]
    status: str
    created_by: str
    created_at: datetime
    updated_at: datetime


class LabelDefinition(BaseModel):
    label_code: str = Field(pattern=r"^[A-Za-z0-9_-]+$", max_length=80)
    label_name: str = Field(min_length=1, max_length=120)
    annotation_type: Literal["classification", "bbox", "polygon", "brush"]
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    required: bool = False
    shortcut: str | None = Field(default=None, max_length=10)
    parent_code: str | None = None
    attributes: list[dict[str, Any]] = Field(default_factory=list)


class LabelSchemaCreate(BaseModel):
    labels: list[LabelDefinition] = Field(min_length=1)
    status: Literal["DRAFT", "PUBLISHED"] = "PUBLISHED"

    @field_validator("labels")
    @classmethod
    def unique_codes(cls, labels: list[LabelDefinition]) -> list[LabelDefinition]:
        codes = [label.label_code for label in labels]
        if len(codes) != len(set(codes)):
            raise ValueError("label_code must be unique")
        return labels


class LabelSchemaOut(ORMModel):
    id: str
    project_id: str
    version: int
    schema_data: dict[str, Any] = Field(validation_alias="schema_json", serialization_alias="schema_json")
    status: str
    created_by: str
    created_at: datetime


class LabelPresetFolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    parent_id: str | None = None


class LabelPresetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    parent_id: str | None = None
    labels: list[LabelDefinition] = Field(min_length=1)

    @field_validator("labels")
    @classmethod
    def unique_codes(cls, labels: list[LabelDefinition]) -> list[LabelDefinition]:
        codes = [label.label_code for label in labels]
        if len(codes) != len(set(codes)):
            raise ValueError("label_code must be unique")
        return labels


class LabelPresetNodeOut(BaseModel):
    id: str
    parent_id: str | None
    node_type: Literal["FOLDER", "PRESET"]
    name: str
    labels: list[LabelDefinition] = Field(default_factory=list)
    created_by: str
    created_at: datetime
    updated_at: datetime


class AssetOut(ORMModel):
    id: str
    dataset_id: str
    series_id: str
    media_type: str
    original_filename: str
    relative_path: str
    width: int
    height: int
    frame_count: int
    checksum: str
    quality_status: str
    phi_suspected: bool


class ImportOut(BaseModel):
    dataset_id: str
    assets: list[AssetOut]
    duplicate_count: int = 0


class DatasetOut(ORMModel):
    id: str
    project_id: str
    name: str
    version: int
    storage_type: str
    manifest_hash: str | None
    created_at: datetime


class TaskCreate(BaseModel):
    media_asset_id: str
    assigned_to: str | None = None
    reviewer_id: str | None = None
    priority: int = Field(default=0, ge=0, le=100)


class TaskBatchCreate(BaseModel):
    media_asset_ids: list[str] = Field(min_length=1)
    assigned_to: str | None = None
    reviewer_id: str | None = None
    priority: int = Field(default=0, ge=0, le=100)

    @field_validator("media_asset_ids")
    @classmethod
    def unique_asset_ids(cls, asset_ids: list[str]) -> list[str]:
        if len(asset_ids) != len(set(asset_ids)):
            raise ValueError("media_asset_ids must be unique")
        return asset_ids


class TaskBatchReassign(BaseModel):
    task_ids: list[str] = Field(min_length=1)
    assigned_to: str | None = None
    reviewer_id: str | None = None

    @field_validator("task_ids")
    @classmethod
    def unique_task_ids(cls, task_ids: list[str]) -> list[str]:
        if len(task_ids) != len(set(task_ids)):
            raise ValueError("task_ids must be unique")
        return task_ids

    @model_validator(mode="after")
    def require_assignment_change(self) -> "TaskBatchReassign":
        if not ({"assigned_to", "reviewer_id"} & self.model_fields_set):
            raise ValueError("assigned_to or reviewer_id must be provided")
        return self


class TaskOut(ORMModel):
    id: str
    project_id: str
    media_asset_id: str
    assigned_to: str | None
    reviewer_id: str | None
    status: TaskStatus
    lock_owner: str | None
    lock_expires_at: datetime | None
    aggregate_version: int
    priority: int


class TaskListOut(TaskOut):
    project_name: str
    media_asset_original_filename: str
    media_asset_relative_path: str


class Point(BaseModel):
    x: float
    y: float


class AnnotationInput(BaseModel):
    annotation_id: str | None = None
    annotation_type: Literal["classification", "bbox", "polygon", "brush"]
    label_id: str = Field(min_length=1, max_length=120)
    frame_index: int = Field(default=0, ge=0)
    coordinate_system: Literal["source_pixel"] = "source_pixel"
    image_width: int = Field(gt=0)
    image_height: int = Field(gt=0)
    geometry: dict[str, Any] = Field(default_factory=dict)
    attributes: dict[str, Any] = Field(default_factory=dict)
    source: Literal["human", "ai"] = "human"
    model_version: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)

    @model_validator(mode="after")
    def validate_geometry(self) -> "AnnotationInput":
        def inside(x: float, y: float) -> bool:
            return 0 <= x <= self.image_width and 0 <= y <= self.image_height

        if self.annotation_type == "bbox":
            required = ("x", "y", "width", "height")
            if not all(key in self.geometry for key in required):
                raise ValueError("bbox requires x, y, width and height")
            x, y, width, height = (float(self.geometry[key]) for key in required)
            if width <= 0 or height <= 0 or not inside(x, y) or not inside(x + width, y + height):
                raise ValueError("bbox must be positive and inside source image")
        elif self.annotation_type == "polygon":
            points = self.geometry.get("points", [])
            if len(points) < 3 or not all(inside(float(point["x"]), float(point["y"])) for point in points):
                raise ValueError("polygon requires three in-bounds points")
        elif self.annotation_type == "brush":
            strokes = self.geometry.get("strokes", [])
            if not strokes:
                raise ValueError("brush requires strokes")
            for stroke in strokes:
                if float(stroke.get("size", 0)) <= 0:
                    raise ValueError("brush size must be positive")
                if not all(inside(float(point["x"]), float(point["y"])) for point in stroke.get("points", [])):
                    raise ValueError("brush points must be inside source image")
        return self


class AnnotationSaveRequest(BaseModel):
    client_version: int = Field(ge=0)
    change_reason: str = Field(default="save", max_length=160)
    annotations: list[AnnotationInput]
    deleted_annotation_ids: list[str] = Field(default_factory=list)


class AnnotationOut(ORMModel):
    id: str
    task_id: str
    annotation_type: str
    label_id: str
    geometry_json: dict[str, Any]
    attributes_json: dict[str, Any]
    frame_index: int
    source: str
    model_version: str | None
    confidence: float | None
    current_version: int


class AnnotationSaveResponse(BaseModel):
    aggregate_version: int
    annotations: list[AnnotationOut]


class ReviewRequest(BaseModel):
    decision: Literal["APPROVED", "CHANGES_REQUESTED", "REJECTED"]
    comment: str = Field(default="", max_length=4000)


class ExportRequest(BaseModel):
    format: Literal["csv", "coco", "yolo", "mask"]
    folder: str = Field(default="", max_length=500)
    include_images: bool = True


class ExportOut(ORMModel):
    id: str
    project_id: str
    format: str
    status: str
    storage_key: str | None
    error: str | None
    created_by: str
    created_at: datetime
    completed_at: datetime | None


class StatisticsOut(BaseModel):
    total_tasks: int
    by_status: dict[str, int]
    approved_annotations: int
