"""Security primitive regression tests."""
from app.core.security import create_access_token, decode_access_token, hash_password, hash_patient_id, verify_password


def test_password_hash_is_salted_and_verifiable() -> None:
    first = hash_password("A-strong-password-123")
    second = hash_password("A-strong-password-123")
    assert first != second
    assert verify_password("A-strong-password-123", first)
    assert not verify_password("wrong-password", first)


def test_signed_access_token_rejects_tampering() -> None:
    secret = "x" * 32
    token = create_access_token("user-1", secret, 5)
    assert decode_access_token(token, secret) == {"sub": "user-1", "exp": decode_access_token(token, secret)["exp"]}
    assert decode_access_token(token + "x", secret) is None


def test_patient_hash_is_stable_and_not_plaintext() -> None:
    result = hash_patient_id("PATIENT-42", "x" * 32)
    assert result == hash_patient_id("PATIENT-42", "x" * 32)
    assert "PATIENT-42" not in result
