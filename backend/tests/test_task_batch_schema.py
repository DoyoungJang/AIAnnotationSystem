"""Batch assignment request validation tests."""

import pytest
from pydantic import ValidationError

from app.schemas.api import TaskBatchCreate, TaskBatchReassign


def test_batch_assignment_accepts_more_than_one_thousand_assets() -> None:
    asset_ids = [f"asset-{index}" for index in range(1_501)]

    payload = TaskBatchCreate(media_asset_ids=asset_ids, assigned_to="annotator")

    assert payload.media_asset_ids == asset_ids


def test_batch_assignment_still_rejects_duplicate_assets() -> None:
    with pytest.raises(ValidationError):
        TaskBatchCreate(media_asset_ids=["asset-1", "asset-1"], assigned_to="annotator")


def test_batch_reassignment_can_change_only_the_reviewer() -> None:
    payload = TaskBatchReassign(task_ids=["task-1"], reviewer_id="reviewer")

    assert payload.assigned_to is None
    assert payload.reviewer_id == "reviewer"
    assert "assigned_to" not in payload.model_fields_set


def test_batch_reassignment_requires_a_change_and_unique_tasks() -> None:
    with pytest.raises(ValidationError):
        TaskBatchReassign(task_ids=["task-1"])
    with pytest.raises(ValidationError):
        TaskBatchReassign(task_ids=["task-1", "task-1"], assigned_to="annotator")
