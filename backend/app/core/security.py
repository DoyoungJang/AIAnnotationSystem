"""Password hashing and short-lived signed access tokens."""
import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any


def hash_password(password: str) -> str:
    """Hash a password using salted PBKDF2-SHA256."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return f"pbkdf2_sha256$310000${base64.urlsafe_b64encode(salt).decode()}${base64.urlsafe_b64encode(digest).decode()}"


def verify_password(password: str, encoded: str) -> bool:
    """Constant-time verification of a PBKDF2 password hash."""
    try:
        algorithm, rounds, salt_text, digest_text = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.urlsafe_b64decode(salt_text), int(rounds))
        return hmac.compare_digest(actual, base64.urlsafe_b64decode(digest_text))
    except (ValueError, TypeError):
        return False


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def create_access_token(subject: str, secret: str, minutes: int) -> str:
    """Create an HMAC-signed compact bearer token."""
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64(json.dumps({"sub": subject, "exp": int(time.time()) + minutes * 60}, separators=(",", ":")).encode())
    signature = _b64(hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())
    return f"{header}.{payload}.{signature}"


def decode_access_token(token: str, secret: str) -> dict[str, Any] | None:
    """Validate and decode a compact bearer token."""
    try:
        header, payload, signature = token.split(".")
        expected = _b64(hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            return None
        data = json.loads(_unb64(payload))
        if int(data["exp"]) <= int(time.time()):
            return None
        return data
    except (ValueError, KeyError, json.JSONDecodeError):
        return None


def hash_patient_id(value: str, secret: str) -> str:
    """Create a stable project-safe pseudonymous patient identifier."""
    return hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()
