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
    user_id = client.get("/api/v1/users/me", headers=headers).json()["id"]
    project = client.post("/api/v1/projects", headers=headers, json={"name":"Fetal US","description":"Synthetic test","task_types":["bbox","polygon"]})
    assert project.status_code == 201; project_id = project.json()["id"]
    manager = client.post("/api/v1/users", headers=headers, json={"username":"manager","display_name":"Project Manager","role":"PROJECT_MANAGER","password":"Manager-password-123"})
    assert manager.status_code == 201
    member = client.post(f"/api/v1/projects/{project_id}/members", headers=headers, json={"user_id":manager.json()["id"]})
    assert member.status_code == 201 and member.json()["project_role"] == "PROJECT_MANAGER"
    manager_login = client.post("/api/v1/auth/login", json={"username":"manager","password":"Manager-password-123"})
    manager_headers = {"Authorization": f"Bearer {manager_login.json()['access_token']}"}
    assert client.get(f"/api/v1/projects/{project_id}", headers=manager_headers).status_code == 200
    assert all(user["role"] not in {"ADMINISTRATOR", "PROJECT_MANAGER"} for user in client.get("/api/v1/users", headers=manager_headers).json())
    forbidden_user = client.post("/api/v1/users", headers=manager_headers, json={"username":"blocked","display_name":"Blocked","role":"ANNOTATOR","password":"Blocked-password-123"})
    assert forbidden_user.status_code == 403
    assert client.post(f"/api/v1/projects/{project_id}/members", headers=manager_headers, json={"user_id":manager.json()["id"]}).status_code == 403
    private_project = client.post("/api/v1/projects", headers=headers, json={"name":"Private","description":"","task_types":["bbox"]})
    assert client.get(f"/api/v1/projects/{private_project.json()['id']}", headers=manager_headers).status_code == 403
    schema = client.post(f"/api/v1/projects/{project_id}/label-schemas", headers=headers, json={"status":"PUBLISHED","labels":[{"label_code":"HEAD","label_name":"Head","annotation_type":"bbox","color":"#00AEEF","required":True}]})
    assert schema.status_code == 201 and schema.json()["schema_json"]["labels"][0]["label_code"] == "HEAD"
    content = BytesIO(); Image.new("L", (128, 96), 70).save(content, "PNG")
    imported = client.post(f"/api/v1/projects/{project_id}/datasets/import", headers=headers, data={"dataset_name":"Synthetic"}, files={"files":("sample.png",content.getvalue(),"image/png")})
    assert imported.status_code == 201 and len(imported.json()["assets"]) == 1
    asset_id = imported.json()["assets"][0]["id"]
    task = client.post(f"/api/v1/projects/{project_id}/tasks", headers=headers, json={"media_asset_id":asset_id,"assigned_to":user_id,"priority":50})
    assert task.status_code == 201
