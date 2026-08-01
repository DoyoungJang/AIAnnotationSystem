# 요구사항과 MVP 범위

## 핵심 사용자 흐름

프로젝트 생성 → 라벨 스키마 확정 → PNG/JPEG/DICOM 등록 → 작업 배정 → Classification/BBox/Polygon/Brush 라벨링 → 자동 저장 → 제출 → 승인/수정 요청 → 승인 데이터 Export.

## MVP 포함

- 로컬 계정 인증과 Administrator, Project Manager, Annotator, Reviewer, Observer RBAC
- 프로젝트 및 버전형 라벨 스키마
- PNG/JPEG와 single/multi-frame DICOM import, 원본 보존, 썸네일 생성
- 환자 해시 ID, Study/Series/Asset 계층
- Canvas 기반 classification, bbox, polygon, brush 작업
- 원본 픽셀 좌표, undo/redo, debounce 자동 저장 및 로컬 임시 저장
- 작업 잠금/heartbeat, optimistic version, annotation snapshot 이력
- 제출, 승인, 수정 요청 workflow
- 승인본 CSV/COCO/YOLO/PNG mask export
- 감사 로그, 백엔드 권한 검사, 안전한 저장 경로
- Docker Compose와 Nginx

## MVP 제외/확장 지점

- SSO, 실시간 공동 좌표 편집, 이중 라벨 consensus/adjudication UI
- OCR 기반 burned-in PHI 자동 탐지, 고급 품질 AI
- 외부/ONNX/gRPC 사전 라벨 실제 모델(Provider 인터페이스만 제공)
- 3D/4D, DICOM SEG/SR, optical flow 전파
- S3/NFS 실제 구현(저장소 인터페이스 제공)
- 대규모 분산 worker. 현재 import/export는 요청 프로세스에서 수행하며 Celery 연결 지점만 문서화

운영 배포 전에 PHI 위협 모델, 기관별 보존 정책, TLS 인증서, 외부 네트워크 차단, 재식별 매핑 별도 키 관리가 필요합니다.
