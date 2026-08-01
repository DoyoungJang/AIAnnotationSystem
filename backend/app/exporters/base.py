"""Approved annotation export strategies."""
import csv
import io
import json
import zipfile
from abc import ABC, abstractmethod
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from PIL import Image, ImageDraw


class BaseExporter(ABC):
    """Convert approved records into a reproducible archive."""
    format: str

    @abstractmethod
    def export(self, rows: list[dict[str, Any]], labels: list[dict[str, Any]], provenance: dict[str, Any]) -> bytes: ...

    @staticmethod
    def archive(files: dict[str, bytes | str], provenance: dict[str, Any]) -> bytes:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as bundle:
            bundle.writestr("manifest.json", json.dumps(provenance, ensure_ascii=False, indent=2))
            for name, content in files.items():
                bundle.writestr(name, content)
        return buffer.getvalue()


class CsvClassificationExporter(BaseExporter):
    format = "csv"
    def export(self, rows: list[dict[str, Any]], labels: list[dict[str, Any]], provenance: dict[str, Any]) -> bytes:
        output = io.StringIO(newline="")
        writer = csv.writer(output); writer.writerow(["sample_id", "asset_id", "label", "frame_index", "annotation_version"])
        for row in rows:
            if row["annotation_type"] == "classification":
                writer.writerow([row["task_id"], row["asset_id"], row["label_id"], row["frame_index"], row["version"]])
        return self.archive({"classification.csv": output.getvalue()}, provenance)


class CocoExporter(BaseExporter):
    format = "coco"
    def export(self, rows: list[dict[str, Any]], labels: list[dict[str, Any]], provenance: dict[str, Any]) -> bytes:
        categories = [{"id": i + 1, "name": label["label_code"]} for i, label in enumerate(labels)]
        category_ids = {category["name"]: category["id"] for category in categories}
        images: dict[str, dict[str, Any]] = {}
        annotations = []
        for index, row in enumerate(rows, 1):
            images[row["asset_id"]] = {"id": row["asset_id"], "file_name": row.get("export_filename", row["original_filename"]), "width": row["width"], "height": row["height"]}
            if row["annotation_type"] not in {"bbox", "polygon"}:
                continue
            geometry = row["geometry"]
            item: dict[str, Any] = {"id": index, "image_id": row["asset_id"], "category_id": category_ids.get(row["label_id"], 0), "iscrowd": 0}
            if row["annotation_type"] == "bbox":
                item["bbox"] = [geometry["x"], geometry["y"], geometry["width"], geometry["height"]]
                item["area"] = geometry["width"] * geometry["height"]
            else:
                flat = [coordinate for point in geometry["points"] for coordinate in (point["x"], point["y"])]
                item["segmentation"] = [flat]
                item["area"] = 0
            annotations.append(item)
        data = {"info": provenance, "images": list(images.values()), "annotations": annotations, "categories": categories}
        return self.archive({"annotations.json": json.dumps(data, ensure_ascii=False, indent=2)}, provenance)


class YoloExporter(BaseExporter):
    format = "yolo"
    def export(self, rows: list[dict[str, Any]], labels: list[dict[str, Any]], provenance: dict[str, Any]) -> bytes:
        label_ids = {label["label_code"]: index for index, label in enumerate(labels)}
        by_asset: dict[str, list[str]] = defaultdict(list)
        for row in rows:
            if row["annotation_type"] != "bbox": continue
            g = row["geometry"]; width, height = row["width"], row["height"]
            by_asset[row["asset_id"]].append(f'{label_ids.get(row["label_id"], 0)} {(g["x"] + g["width"] / 2) / width:.6f} {(g["y"] + g["height"] / 2) / height:.6f} {g["width"] / width:.6f} {g["height"] / height:.6f}')
        files: dict[str, bytes | str] = {f"labels/{asset}.txt": "\n".join(lines) for asset, lines in by_asset.items()}
        files["classes.txt"] = "\n".join(label["label_code"] for label in labels)
        return self.archive(files, provenance)


class MaskExporter(BaseExporter):
    format = "mask"
    def export(self, rows: list[dict[str, Any]], labels: list[dict[str, Any]], provenance: dict[str, Any]) -> bytes:
        label_ids = {label["label_code"]: index + 1 for index, label in enumerate(labels)}
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            if row["annotation_type"] in {"polygon", "brush"}: grouped[row["asset_id"]].append(row)
        files: dict[str, bytes | str] = {}
        for asset_id, items in grouped.items():
            mask = Image.new("L", (items[0]["width"], items[0]["height"]), 0); draw = ImageDraw.Draw(mask)
            for row in items:
                value = label_ids.get(row["label_id"], 0); geometry = row["geometry"]
                if row["annotation_type"] == "polygon":
                    draw.polygon([(p["x"], p["y"]) for p in geometry["points"]], fill=value)
                else:
                    for stroke in geometry["strokes"]:
                        points = [(p["x"], p["y"]) for p in stroke["points"]]
                        if len(points) == 1: draw.ellipse([points[0][0] - stroke["size"] / 2, points[0][1] - stroke["size"] / 2, points[0][0] + stroke["size"] / 2, points[0][1] + stroke["size"] / 2], fill=value)
                        elif points: draw.line(points, fill=value, width=max(1, int(stroke["size"])), joint="curve")
            stream = io.BytesIO(); mask.save(stream, "PNG"); files[f"masks/{asset_id}.png"] = stream.getvalue()
        return self.archive(files, provenance)


EXPORTERS: dict[str, BaseExporter] = {item.format: item for item in (CsvClassificationExporter(), CocoExporter(), YoloExporter(), MaskExporter())}
