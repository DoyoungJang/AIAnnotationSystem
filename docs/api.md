# API 개요

FastAPI가 `/docs`에 OpenAPI 문서를 제공합니다. 보호 endpoint는 `Authorization: Bearer <token>`을 요구합니다.

- `/api/v1/auth/login`, `/api/v1/users/me`
- `/api/v1/projects`, `/api/v1/projects/{id}/label-schemas`
- `/api/v1/projects/{id}/datasets/import`, `/api/v1/datasets/{id}/assets`
- `/api/v1/tasks/my`, `/api/v1/tasks/{id}/lock|heartbeat|annotations|submit|review|versions`
- `/api/v1/projects/{id}/exports`, `/api/v1/exports/{id}`
- `/api/v1/projects/{id}/statistics`, `/api/v1/audit-logs`

Annotation 저장은 `Idempotency-Key` header와 `client_version` optimistic concurrency를 지원합니다.
