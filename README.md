# SonoLabel

온프레미스 의료 초음파 데이터 라벨링을 위한 실행 가능한 MVP입니다. 의료영상은 외부 서비스로 전송하지 않으며, 원본 파일과 Annotation 버전을 분리해 보존합니다.

## 자동 실행 스크립트

Ubuntu와 Windows 모두 하나의 스크립트로 FastAPI 백엔드와 React/Vite 웹 UI를 함께 시작할 수 있습니다. 첫 실행에서는 Python 가상환경과 Node.js 패키지를 자동으로 설치합니다. 이후 실행에서는 기존 의존성을 재사용합니다.

기본 주소는 다음과 같습니다.

- 웹 UI: http://localhost:5173
- API 문서: http://localhost:8000/docs
- 초기 관리자: `admin` / `ChangeThisBeforeUse123!`

운영 또는 공유 환경에서는 스크립트의 `SECRET_KEY`, `ADMIN_PASSWORD` 기본값을 반드시 변경하십시오.

### Ubuntu에서 실행

필수 프로그램:

- Ubuntu 22.04 이상
- Python 3.11 이상과 `python3-venv`
- Node.js 20 이상과 npm

처음 한 번 실행 권한을 부여한 뒤 스크립트를 실행합니다.

```bash
chmod +x scripts/start-ubuntu.sh
./scripts/start-ubuntu.sh
```

웹 브라우저에서 http://localhost:5173 을 엽니다. 종료할 때는 실행 중인 터미널에서 `Ctrl+C`를 누릅니다. 백엔드와 프론트엔드가 함께 종료됩니다.

포트 등 기본값은 [scripts/start-ubuntu.sh](scripts/start-ubuntu.sh) 상단의 설정 영역에서 직접 변경할 수 있습니다.

```bash
API_HOST="127.0.0.1"
API_PROXY_HOST="127.0.0.1"
API_PORT="8000"
WEB_HOST="0.0.0.0"
WEB_PORT="5173"
INSTALL_MODE="auto"
```

파일을 수정하지 않고 한 번만 다른 포트로 실행할 수도 있습니다.

```bash
API_PORT=9000 WEB_PORT=3000 ./scripts/start-ubuntu.sh
```

`INSTALL_MODE` 값은 다음과 같습니다.

- `auto`: 가상환경이나 `node_modules`가 없을 때만 설치합니다.
- `always`: 실행할 때마다 의존성을 다시 확인하고 설치합니다.
- `never`: 설치하지 않고 기존 환경만 사용합니다.

Ubuntu에서 `python3 -m venv` 오류가 발생하면 다음 패키지를 설치하십시오.

```bash
sudo apt update
sudo apt install python3-venv python3-pip
```

### Windows에서 실행

필수 프로그램:

- Windows 10/11
- Python 3.11 이상
- Node.js 20 이상과 npm

파일 탐색기에서 [scripts/start-windows.bat](scripts/start-windows.bat)을 더블 클릭하거나 PowerShell/명령 프롬프트에서 실행합니다.

```bat
scripts\start-windows.bat
```

Windows 실행 정책을 별도로 변경할 필요는 없습니다. 배치 파일이 현재 실행에만 `ExecutionPolicy Bypass`를 적용합니다. 브라우저에서 http://localhost:5173 을 열고, 종료할 때 실행 창에서 `Ctrl+C`를 누릅니다.

포트는 `scripts/start-windows.bat` 상단에서 변경합니다.

```bat
set "API_PORT=8000"
set "WEB_PORT=5173"
```

PowerShell 스크립트를 직접 실행하면 명령행 인자도 사용할 수 있습니다.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-windows.ps1 `
  -ApiPort 9000 `
  -WebPort 3000 `
  -InstallMode Auto
```

### 공통 설정

| 설정 | 기본값 | 설명 |
|---|---:|---|
| `API_HOST` / `ApiHost` | `127.0.0.1` | FastAPI bind 주소 |
| `API_PROXY_HOST` / `ApiProxyHost` | `127.0.0.1` | Vite가 API에 접속할 내부 주소 |
| `API_PORT` / `ApiPort` | `8000` | FastAPI와 API 문서 포트 |
| `WEB_HOST` / `WebHost` | `0.0.0.0` | 웹 UI bind 주소 |
| `WEB_PORT` / `WebPort` | `5173` | 웹 UI 포트 |
| `INSTALL_MODE` / `InstallMode` | `auto` / `Auto` | 의존성 자동 설치 정책 |
| `DATABASE_URL` | `backend/sonolabel.db` | SQLAlchemy 데이터베이스 URL |
| `STORAGE_ROOT` | `storage` | 원본 영상 보호 저장 경로 |
| `EXPORT_ROOT` | `exports` | Export 결과 경로 |

API 포트를 변경하면 실행 스크립트가 `SONOLABEL_API_TARGET`을 설정하므로 Vite proxy도 같은 포트를 자동으로 사용합니다. 웹 포트를 변경하면 CORS 허용 주소도 함께 변경됩니다.

외부 PC에서 접속하려면 방화벽에서 `WEB_PORT`를 허용하고 `WEB_HOST=0.0.0.0`을 유지하십시오. API는 기본적으로 로컬 인터페이스에만 bind되며 웹 UI의 proxy를 통해 접근합니다.

## Docker Compose 실행

운영과 유사한 PostgreSQL·Redis·Nginx 환경은 Docker Compose로 실행합니다.

```bash
cp .env.example .env       # Ubuntu
docker compose up --build
```

```powershell
Copy-Item .env.example .env # Windows
docker compose up --build
```

- 웹 UI: http://localhost:8080
- API 문서: http://localhost:8080/docs
- 초기 관리자: `.env`의 `ADMIN_USERNAME` / `ADMIN_PASSWORD`

## 수동 개발 실행과 테스트

세부 개발 명령, 테스트, 배포 및 백업 방법은 [docs/deployment.md](docs/deployment.md)를 참고하십시오. MVP 범위와 제외 기능은 [docs/requirements.md](docs/requirements.md)에 정리되어 있습니다.

> 이 MVP는 연구용 데이터 구축 도구의 출발점입니다. 실제 임상·운영 도입 전 기관 보안 검토, 침투 테스트, 백업 복구 훈련과 DICOM codec 검증이 필요합니다.
