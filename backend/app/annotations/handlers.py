"""Extensible validation strategies for annotation types."""
from abc import ABC, abstractmethod
from typing import Any


class BaseAnnotationHandler(ABC):
    """Annotation geometry strategy extension point."""
    annotation_type: str

    @abstractmethod
    def normalize(self, geometry: dict[str, Any]) -> dict[str, Any]: ...


class PassthroughHandler(BaseAnnotationHandler):
    """Use Pydantic-validated geometry without lossy conversion."""

    def __init__(self, annotation_type: str) -> None:
        self.annotation_type = annotation_type

    def normalize(self, geometry: dict[str, Any]) -> dict[str, Any]:
        return geometry


class AnnotationHandlerRegistry:
    """Resolve handlers while allowing new plugins to register."""

    def __init__(self) -> None:
        self.handlers = {name: PassthroughHandler(name) for name in ("classification", "bbox", "polygon", "brush")}

    def get(self, annotation_type: str) -> BaseAnnotationHandler:
        try:
            return self.handlers[annotation_type]
        except KeyError as error:
            raise ValueError(f"Unsupported annotation type: {annotation_type}") from error
