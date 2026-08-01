"""AI pre-label provider extension points."""
from abc import ABC, abstractmethod
from typing import Any


class BasePreLabelProvider(ABC):
    """Inference adapter that never blocks manual annotation availability."""
    @abstractmethod
    def predict(self, storage_key: str, task_types: list[str]) -> list[dict[str, Any]]: ...


class DisabledPreLabelProvider(BasePreLabelProvider):
    """Safe default for installations without an internal model."""
    def predict(self, storage_key: str, task_types: list[str]) -> list[dict[str, Any]]:
        return []
