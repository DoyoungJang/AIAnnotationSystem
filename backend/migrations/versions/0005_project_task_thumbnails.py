"""Add per-project task thumbnail visibility setting."""
from alembic import op
import sqlalchemy as sa


revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("projects")}
    if "show_task_thumbnails" in columns:
        return
    op.add_column(
        "projects",
        sa.Column("show_task_thumbnails", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("projects")}
    if "show_task_thumbnails" in columns:
        op.drop_column("projects", "show_task_thumbnails")
