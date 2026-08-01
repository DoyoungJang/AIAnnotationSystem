# SonoLabel

온프레미스 의료 초음파 데이터 라벨링을 위한 실행 가능한 MVP입니다. 의료영상은 외부 서비스로 전송하지 않으며, 원본 파일과 Annotation 버전을 분리해 보존합니다.

## 빠른 시작

```bash
copy .env.example .env
docker compose up --build
```

- 웹 UI: http://localhost:8080
- API 문서: http://localhost:8000/docs
- 초기 관리자: `.env`의 `ADMIN_USERNAME` / `ADMIN_PASSWORD`

로컬 개발과 테스트 방법은 [docs/deployment.md](docs/deployment.md), MVP 범위는 [docs/requirements.md](docs/requirements.md)를 참고하십시오.

> 이 MVP는 연구용 데이터 구축 도구의 출발점입니다. 실제 임상/운영 도입 전 기관 보안 검토, 침투 테스트, 백업 복구 훈련, DICOM codec 검증이 필요합니다.
