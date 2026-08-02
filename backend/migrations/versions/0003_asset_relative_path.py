"""Preserve imported folder-relative asset paths."""
from alembic import op
import sqlalchemy as sa


revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("media_assets")}
    if "relative_path" in columns:
        return
    op.add_column("media_assets", sa.Column("relative_path", sa.String(length=1000), nullable=False, server_default=""))
    op.execute(sa.text("UPDATE media_assets SET relative_path = original_filename WHERE relative_path = ''"))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("media_assets")}
    if "relative_path" in columns:
        op.drop_column("media_assets", "relative_path")
