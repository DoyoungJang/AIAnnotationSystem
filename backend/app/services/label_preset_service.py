"""Shared, hierarchical label preset library for project managers."""
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import LabelPresetNode, Role, User
from app.schemas.api import LabelPresetCreate, LabelPresetFolderCreate
from app.services.audit_service import AuditService


MANAGE_ROLES = {Role.ADMINISTRATOR, Role.PROJECT_MANAGER}


class LabelPresetService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.audit = AuditService(db)

    def list_nodes(self, actor: User) -> list[LabelPresetNode]:
        self._require_manager(actor)
        return list(self.db.scalars(
            select(LabelPresetNode).order_by(LabelPresetNode.node_type, LabelPresetNode.name, LabelPresetNode.created_at)
        ).all())

    def create_folder(self, actor: User, payload: LabelPresetFolderCreate) -> LabelPresetNode:
        self._require_manager(actor)
        name = self._clean_name(payload.name)
        self._require_folder(payload.parent_id)
        self._require_unique_name(payload.parent_id, name)
        folder = LabelPresetNode(
            parent_id=payload.parent_id,
            node_type="FOLDER",
            name=name,
            labels_json={},
            created_by=actor.id,
        )
        self.db.add(folder)
        self.db.flush()
        self.audit.record(actor, "LABEL_PRESET_FOLDER_CREATED", "label_preset_folder", folder.id, None, f"Preset folder created: {name}")
        self.db.commit()
        return folder

    def create_preset(self, actor: User, payload: LabelPresetCreate) -> LabelPresetNode:
        self._require_manager(actor)
        name = self._clean_name(payload.name)
        self._require_folder(payload.parent_id)
        self._require_unique_name(payload.parent_id, name)
        preset = LabelPresetNode(
            parent_id=payload.parent_id,
            node_type="PRESET",
            name=name,
            labels_json={"labels": [label.model_dump() for label in payload.labels]},
            created_by=actor.id,
        )
        self.db.add(preset)
        self.db.flush()
        self.audit.record(actor, "LABEL_PRESET_CREATED", "label_preset", preset.id, None, f"Label preset created: {name}")
        self.db.commit()
        return preset

    def delete_node(self, actor: User, node_id: str) -> None:
        self._require_manager(actor)
        node = self.db.get(LabelPresetNode, node_id)
        if node is None:
            raise HTTPException(404, "프리셋 또는 폴더를 찾을 수 없습니다.")
        descendants = self._descendants(node_id)
        if actor.role != Role.ADMINISTRATOR and any(item.created_by != actor.id for item in [node, *descendants]):
            raise HTTPException(403, "다른 관리자가 만든 프리셋 항목은 삭제할 수 없습니다.")
        resource_type = "label_preset_folder" if node.node_type == "FOLDER" else "label_preset"
        self.audit.record(actor, "LABEL_PRESET_NODE_DELETED", resource_type, node.id, None, f"Preset library item deleted: {node.name}")
        for child in reversed(descendants):
            self.db.delete(child)
        self.db.delete(node)
        self.db.commit()

    def _descendants(self, node_id: str) -> list[LabelPresetNode]:
        descendants: list[LabelPresetNode] = []
        pending = [node_id]
        while pending:
            children = list(self.db.scalars(select(LabelPresetNode).where(LabelPresetNode.parent_id.in_(pending))).all())
            descendants.extend(children)
            pending = [child.id for child in children]
        return descendants

    def _require_manager(self, actor: User) -> None:
        if actor.role not in MANAGE_ROLES:
            raise HTTPException(403, "라벨 프리셋 관리 권한이 없습니다.")

    def _require_folder(self, parent_id: str | None) -> None:
        if parent_id is None:
            return
        parent = self.db.get(LabelPresetNode, parent_id)
        if parent is None:
            raise HTTPException(404, "상위 폴더를 찾을 수 없습니다.")
        if parent.node_type != "FOLDER":
            raise HTTPException(422, "프리셋 아래에는 항목을 만들 수 없습니다. 폴더를 선택하세요.")

    def _require_unique_name(self, parent_id: str | None, name: str) -> None:
        query = select(LabelPresetNode).where(LabelPresetNode.name == name)
        query = query.where(LabelPresetNode.parent_id == parent_id) if parent_id else query.where(LabelPresetNode.parent_id.is_(None))
        if self.db.scalar(query):
            raise HTTPException(409, "같은 폴더에 동일한 이름이 이미 있습니다.")

    @staticmethod
    def _clean_name(name: str) -> str:
        clean = name.strip()
        if not clean:
            raise HTTPException(422, "이름을 입력하세요.")
        return clean


def serialize_preset_node(node: LabelPresetNode) -> dict:
    return {
        "id": node.id,
        "parent_id": node.parent_id,
        "node_type": node.node_type,
        "name": node.name,
        "labels": node.labels_json.get("labels", []) if node.node_type == "PRESET" else [],
        "created_by": node.created_by,
        "created_at": node.created_at,
        "updated_at": node.updated_at,
    }
