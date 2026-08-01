"""Import helper: use the authenticated REST multipart endpoint."""
import argparse
import mimetypes
from pathlib import Path
import logging


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Use the web UI or POST /api/v1/projects/{id}/datasets/import for protected imports")
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    supported = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".dcm", ".dicom"}
    files = [path for path in args.directory.rglob("*") if path.suffix.lower() in supported]
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.info("Validated %d candidate files. Upload through the authenticated API to preserve audit records.", len(files))
