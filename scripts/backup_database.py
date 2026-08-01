"""Print the safe database backup command without handling credentials."""
import logging

logging.basicConfig(level=logging.INFO, format="%(message)s")
logging.info("Run: docker compose exec -T db pg_dump -U sonolabel sonolabel > sonolabel.sql")
