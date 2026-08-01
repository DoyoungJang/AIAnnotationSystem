# 개발·배포·백업

## 로컬 개발 및 테스트

```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -e .[dev]
set DATABASE_URL=sqlite:///./sonolabel.db
python -m app.bootstrap
uvicorn app.main:app --reload
pytest
```

```bash
cd frontend
npm install
npm run dev
npm test -- --run
npm run build
```

## 운영

`.env.example`을 `.env`로 복사하고 비밀값을 변경한 뒤 `docker compose up -d --build`를 실행합니다. TLS와 폐쇄망 egress policy는 기관 인프라에서 적용합니다.

## Backup/Restore

DB와 storage를 같은 recovery point로 백업합니다.

```bash
docker compose exec -T db pg_dump -U sonolabel sonolabel > sonolabel.sql
docker compose exec -T db psql -U sonolabel sonolabel < sonolabel.sql
```

storage/export volume은 암호화된 증분 백업을 사용하고 정기 restore drill과 checksum 검증을 수행합니다.
