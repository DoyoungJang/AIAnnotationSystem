"""Store per-user labeling keyboard shortcuts."""
from alembic import op
import sqlalchemy as sa


revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("users")}
    if "shortcut_settings" in columns:
        return
    op.add_column(
        "users",
        sa.Column("shortcut_settings", sa.JSON(), nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("users")}
    if "shortcut_settings" in columns:
        op.drop_column("users", "shortcut_settings")
