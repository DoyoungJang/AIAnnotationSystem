"""Batch assignment request validation tests."""

import pytest
from pydantic import ValidationError

from app.schemas.api import TaskBatchCreate


def test_batch_assignment_accepts_more_than_one_thousand_assets() -> None:
    asset_ids = [f"asset-{index}" for index in range(1_501)]

    payload = TaskBatchCreate(media_asset_ids=asset_ids, assigned_to="annotator")

    assert payload.media_asset_ids == asset_ids


def test_batch_assignment_still_rejects_duplicate_assets() -> None:
    with pytest.raises(ValidationError):
        TaskBatchCreate(media_asset_ids=["asset-1", "asset-1"], assigned_to="annotator")
