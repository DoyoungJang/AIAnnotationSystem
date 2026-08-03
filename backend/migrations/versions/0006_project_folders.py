"""Add hierarchical folder paths for projects."""
from alembic import op
import sqlalchemy as sa


revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("projects")}
    if "folder_path" in columns:
        return
    op.add_column("projects", sa.Column("folder_path", sa.String(length=500), nullable=False, server_default=""))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("projects")}
    if "folder_path" in columns:
        op.drop_column("projects", "folder_path")
