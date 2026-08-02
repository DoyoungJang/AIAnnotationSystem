"""Path traversal-safe local storage adapter."""
from pathlib import Path

from app.storage.base import BaseStorageProvider


class LocalStorageProvider(BaseStorageProvider):
    """Persist opaque keys beneath one configured root."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def resolve(self, key: str) -> Path:
        candidate = (self.root / key).resolve()
        if candidate != self.root and self.root not in candidate.parents:
            raise ValueError("invalid storage key")
        return candidate

    def put(self, key: str, data: bytes) -> None:
        path = self.resolve(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def read(self, key: str) -> bytes:
        return self.resolve(key).read_bytes()
