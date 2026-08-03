"""HTTP integration test for login → project → schema → import → assignment."""
from io import BytesIO
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.routes import router
from app.core.config import Settings, get_settings
from app.core.security import hash_password
from app.db import Base, get_db
from app.models.entities import Role, User


def test_http_mvp_setup_flow(tmp_path: Path) -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    settings = Settings(secret_key="x" * 32, storage_root=tmp_path / "storage", export_root=tmp_path / "exports", _env_file=None)
    with Session(engine) as db:
        db.add(User(username="admin", display_name="Admin", role=Role.ADMINISTRATOR, password_hash=hash_password("Strong-password-123"))); db.commit()
    app = FastAPI(); app.include_router(router)
    def test_db():
        with Session(engine) as db: yield db
    app.dependency_overrides[get_db] = test_db
    app.dependency_overrides[get_settings] = lambda: settings
    client = TestClient(app)
    login = client.post("/api/v1/auth/login", json={"username":"admin","password":"Strong-password-123"})
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    me = client.get("/api/v1/users/me", headers=headers).json()
    user_id = me["id"]
    assert me["shortcut_settings"] == {}
    shortcuts = client.patch(
        "/api/v1/users/me/shortcuts",
        headers=headers,
        json={"previous_image": "KeyA", "next_image": "KeyD", "submit": "Enter"},
    )
    assert shortcuts.status_code == 200
    assert shortcuts.json()["shortcut_settings"] == {"previous_image": "KeyA", "next_image": "KeyD", "submit": "Enter"}
    duplicate_shortcuts = client.patch(
        "/api/v1/users/me/shortcuts",
        headers=headers,
        json={"previous_image": "KeyA", "next_image": "KeyA", "submit": "Enter"},
    )
    assert duplicate_shortcuts.status_code == 422
    project = client.post("/api/v1/projects", headers=headers, json={"name":"Fetal US","description":"Synthetic test","task_types":["bbox","polygon"]})
    assert project.status_code == 201
    assert project.json()["show_task_thumbnails"] is False
    project_id = project.json()["id"]
    manager = client.post("/api/v1/users", headers=headers, json={"username":"manager","display_name":"Project Manager","role":"PROJECT_MANAGER","password":"Manager-password-123"})
    assert manager.status_code == 201
    annotator = client.post("/api/v1/users", headers=headers, json={"username":"annotator","display_name":"Annotator","role":"ANNOTATOR","password":"Annotator-password-123"})
    assert annotator.status_code == 201
    member = client.post(f"/api/v1/projects/{project_id}/members", headers=headers, json={"user_id":manager.json()["id"]})
    assert member.status_code == 201 and member.json()["project_role"] == "PROJECT_MANAGER"
    manager_login = client.post("/api/v1/auth/login", json={"username":"manager","password":"Manager-password-123"})
    manager_headers = {"Authorization": f"Bearer {manager_login.json()['access_token']}"}
    assert client.get(f"/api/v1/projects/{project_id}", headers=manager_headers).status_code == 200
    assert all(user["role"] not in {"ADMINISTRATOR", "PROJECT_MANAGER"} for user in client.get("/api/v1/users", headers=manager_headers).json())
    added_by_manager = client.post(f"/api/v1/projects/{project_id}/members", headers=manager_headers, json={"user_id":annotator.json()["id"]})
    assert added_by_manager.status_code == 201 and added_by_manager.json()["project_role"] == "ANNOTATOR"
    preview_setting = client.patch(f"/api/v1/projects/{project_id}/preview-settings", headers=manager_headers, json={"show_task_thumbnails":True})
    assert preview_setting.status_code == 200 and preview_setting.json()["show_task_thumbnails"] is True
    forbidden_user = client.post("/api/v1/users", headers=manager_headers, json={"username":"blocked","display_name":"Blocked","role":"ANNOTATOR","password":"Blocked-password-123"})
    assert forbidden_user.status_code == 403
    assert client.post(f"/api/v1/projects/{project_id}/members", headers=manager_headers, json={"user_id":manager.json()["id"]}).status_code == 403
    private_project = client.post("/api/v1/projects", headers=headers, json={"name":"Private","description":"","task_types":["bbox"]})
    assert client.get(f"/api/v1/projects/{private_project.json()['id']}", headers=manager_headers).status_code == 403
    schema = client.post(f"/api/v1/projects/{project_id}/label-schemas", headers=headers, json={"status":"PUBLISHED","labels":[{"label_code":"HEAD","label_name":"Head","annotation_type":"bbox","color":"#00AEEF","required":True}]})
    assert schema.status_code == 201 and schema.json()["schema_json"]["labels"][0]["label_code"] == "HEAD"
    manager_schema = client.post(f"/api/v1/projects/{project_id}/label-schemas", headers=manager_headers, json={"status":"PUBLISHED","labels":[{"label_code":"HEAD","label_name":"Head","annotation_type":"bbox","color":"#00AEEF","required":True},{"label_code":"LESION_BORDER","label_name":"Lesion border","annotation_type":"polygon","color":"#35D4BD","required":False,"shortcut":"5"}]})
    assert manager_schema.status_code == 201
    assert manager_schema.json()["version"] == 2
    assert manager_schema.json()["schema_json"]["labels"][1]["label_code"] == "LESION_BORDER"
    department = client.post("/api/v1/label-presets/folders", headers=manager_headers, json={"name":"Radiology","parent_id":None})
    assert department.status_code == 201 and department.json()["node_type"] == "FOLDER"
    specialty = client.post("/api/v1/label-presets/folders", headers=manager_headers, json={"name":"Breast","parent_id":department.json()["id"]})
    assert specialty.status_code == 201 and specialty.json()["parent_id"] == department.json()["id"]
    preset = client.post("/api/v1/label-presets", headers=manager_headers, json={"name":"Breast lesion","parent_id":specialty.json()["id"],"labels":manager_schema.json()["schema_json"]["labels"]})
    assert preset.status_code == 201
    assert preset.json()["labels"][1]["label_code"] == "LESION_BORDER"
    listed_presets = client.get("/api/v1/label-presets", headers=headers)
    assert listed_presets.status_code == 200 and {item["id"] for item in listed_presets.json()} == {department.json()["id"], specialty.json()["id"], preset.json()["id"]}
    duplicate = client.post("/api/v1/label-presets", headers=manager_headers, json={"name":"Breast lesion","parent_id":specialty.json()["id"],"labels":manager_schema.json()["schema_json"]["labels"]})
    assert duplicate.status_code == 409
    invalid_parent = client.post("/api/v1/label-presets/folders", headers=manager_headers, json={"name":"Invalid","parent_id":preset.json()["id"]})
    assert invalid_parent.status_code == 422
    annotator_login = client.post("/api/v1/auth/login", json={"username":"annotator","password":"Annotator-password-123"})
    annotator_headers = {"Authorization": f"Bearer {annotator_login.json()['access_token']}"}
    assert client.patch(f"/api/v1/projects/{project_id}/preview-settings", headers=annotator_headers, json={"show_task_thumbnails":False}).status_code == 403
    assert client.get("/api/v1/label-presets", headers=annotator_headers).status_code == 403
    admin_folder = client.post("/api/v1/label-presets/folders", headers=headers, json={"name":"Admin shared","parent_id":None})
    assert client.delete(f"/api/v1/label-presets/{admin_folder.json()['id']}", headers=manager_headers).status_code == 403
    assert client.delete(f"/api/v1/label-presets/{admin_folder.json()['id']}", headers=headers).status_code == 204
    deleted = client.delete(f"/api/v1/label-presets/{department.json()['id']}", headers=headers)
    assert deleted.status_code == 204 and client.get("/api/v1/label-presets", headers=headers).json() == []
    files = []
    for index, shade in enumerate((70, 90, 110), start=1):
        content = BytesIO(); Image.new("L", (128, 96), shade).save(content, "PNG")
        files.append(("files", (f"sample-{index}.png", content.getvalue(), "image/png")))
    imported = client.post(f"/api/v1/projects/{project_id}/datasets/import", headers=headers, data={"dataset_name":"Synthetic", "relative_paths":["Fetal US/trimester-1/sample-1.png", "Fetal US/trimester-1/sample-2.png", "Fetal US/trimester-2/sample-3.png"]}, files=files)
    assert imported.status_code == 201 and len(imported.json()["assets"]) == 3
    asset_ids = [asset["id"] for asset in imported.json()["assets"]]
    asset_id = asset_ids[0]
    task = client.post(f"/api/v1/projects/{project_id}/tasks", headers=headers, json={"media_asset_id":asset_id,"assigned_to":user_id,"priority":50})
    assert task.status_code == 201
    batch = client.post(f"/api/v1/projects/{project_id}/tasks/batch", headers=headers, json={"media_asset_ids":asset_ids[1:],"assigned_to":annotator.json()["id"],"reviewer_id":user_id,"priority":60})
    assert batch.status_code == 201
    assert {task["media_asset_id"] for task in batch.json()} == set(asset_ids[1:])
    assert all(task["status"] == "ASSIGNED" and task["priority"] == 60 for task in batch.json())
    annotator_tasks = client.get("/api/v1/tasks/my", headers=annotator_headers)
    assert annotator_tasks.status_code == 200 and len(annotator_tasks.json()) == 2
    assert all(task["show_task_thumbnails"] is True for task in annotator_tasks.json())
    assert {task["project_name"] for task in annotator_tasks.json()} == {"Fetal US"}
    assert {task["media_asset_relative_path"] for task in annotator_tasks.json()} == {"Fetal US/trimester-1/sample-2.png", "Fetal US/trimester-2/sample-3.png"}
    assert {task["media_asset_original_filename"] for task in annotator_tasks.json()} == {"sample-2.png", "sample-3.png"}
    duplicate_batch = client.post(f"/api/v1/projects/{project_id}/tasks/batch", headers=headers, json={"media_asset_ids":[asset_ids[1],asset_ids[1]],"assigned_to":annotator.json()["id"]})
    assert duplicate_batch.status_code == 422
