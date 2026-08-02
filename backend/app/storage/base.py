"""Replaceable protected storage contract."""
from abc import ABC, abstractmethod
from pathlib import Path


class BaseStorageProvider(ABC):
    """Store and resolve files by opaque keys."""

    @abstractmethod
    def put(self, key: str, data: bytes) -> None: ...

    @abstractmethod
    def resolve(self, key: str) -> Path: ...

    @abstractmethod
    def read(self, key: str) -> bytes: ...
