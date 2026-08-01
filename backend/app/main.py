"""SonoLabel FastAPI application entry point."""
import logging
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import router
from app.bootstrap import bootstrap
from app.core.config import get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("sonolabel")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    bootstrap()
    yield


app = FastAPI(title="SonoLabel API", version="0.1.0", lifespan=lifespan)
settings = get_settings()
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=False, allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type", "Idempotency-Key"])
app.include_router(router)


@app.get("/health")
def health() -> dict[str, str]:
    """Return a PHI-free service readiness marker."""
    return {"status": "ok"}


@app.exception_handler(Exception)
async def unhandled_error(request: Request, error: Exception) -> JSONResponse:
    logger.exception("Unhandled request error", extra={"path": request.url.path, "method": request.method})
    return JSONResponse(status_code=500, content={"detail": "서버에서 요청을 처리하지 못했습니다."})
