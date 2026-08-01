"""Authentication and authorization dependencies."""
from collections.abc import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.security import decode_access_token
from app.db import get_db
from app.models.entities import Role, User

bearer = HTTPBearer(auto_error=False)


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    """Resolve an active user from a signed bearer token."""
    error = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="인증이 필요합니다.")
    if credentials is None:
        raise error
    payload = decode_access_token(credentials.credentials, settings.secret_key)
    user = db.get(User, payload.get("sub")) if payload else None
    if user is None or user.status != "ACTIVE":
        raise error
    return user


def require_roles(*roles: Role) -> Callable[..., User]:
    """Create a dependency that restricts a route to selected roles."""
    def dependency(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="이 작업을 수행할 권한이 없습니다.")
        return user
    return dependency
