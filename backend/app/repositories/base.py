"""Small typed repository helpers."""
from typing import Generic, TypeVar

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import Base

ModelT = TypeVar("ModelT", bound=Base)


class Repository(Generic[ModelT]):
    """CRUD access for one SQLAlchemy model."""

    def __init__(self, db: Session, model: type[ModelT]) -> None:
        self.db = db
        self.model = model

    def get(self, entity_id: str) -> ModelT | None:
        return self.db.get(self.model, entity_id)

    def list(self, **filters: object) -> list[ModelT]:
        return list(self.db.scalars(select(self.model).filter_by(**filters)).all())

    def add(self, entity: ModelT) -> ModelT:
        self.db.add(entity)
        self.db.flush()
        return entity
