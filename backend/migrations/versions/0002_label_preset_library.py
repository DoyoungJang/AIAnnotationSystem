"""Add the hierarchical label preset library."""
from alembic import op
import sqlalchemy as sa


revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if sa.inspect(bind).has_table("label_preset_nodes"):
        return
    op.create_table(
        "label_preset_nodes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("parent_id", sa.String(length=36), nullable=True),
        sa.Column("node_type", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("labels_json", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["parent_id"], ["label_preset_nodes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_label_preset_nodes_parent_id", "label_preset_nodes", ["parent_id"])
    op.create_index("ix_label_preset_nodes_node_type", "label_preset_nodes", ["node_type"])
    op.create_index("ix_label_preset_parent_name", "label_preset_nodes", ["parent_id", "name"])


def downgrade() -> None:
    bind = op.get_bind()
    if sa.inspect(bind).has_table("label_preset_nodes"):
        op.drop_table("label_preset_nodes")
