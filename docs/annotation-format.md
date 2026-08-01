# Annotation JSON 규격

좌표계는 `source_pixel`이며 좌상단 원점, x는 오른쪽, y는 아래 방향입니다. 모든 좌표는 `[0,width] × [0,height]` 내부여야 합니다.

```json
{
  "client_version": 4,
  "change_reason": "autosave",
  "annotations": [{
    "annotation_id": "uuid", "annotation_type": "bbox",
    "label_id": "fetal_head", "frame_index": 0,
    "coordinate_system": "source_pixel", "image_width": 1024,
    "image_height": 768,
    "geometry": {"x": 100, "y": 120, "width": 240, "height": 180},
    "attributes": {}, "source": "human", "model_version": null,
    "confidence": null
  }],
  "deleted_annotation_ids": []
}
```

- `classification`: geometry `{}`
- `bbox`: `{x,y,width,height}` with positive width/height
- `polygon`: `{points:[{x,y},...]}` with at least three points
- `brush`: `{strokes:[{size,points:[{x,y},...]}]}`; export 시 원본 해상도 mask로 rasterize

서버는 task aggregate version을 증가시키고 개별 Annotation마다 immutable snapshot을 생성합니다. 버전 불일치는 HTTP 409와 현재 서버 버전을 반환합니다.
