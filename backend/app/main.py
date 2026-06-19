import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import clusters, comparison, physical_servers, resources, sync
from app.config import settings
from app.services import sync_service

log = logging.getLogger(__name__)

SYNC_INTERVAL_SECONDS = 4 * 3600


async def _periodic_sync_loop():
    while True:
        try:
            await sync_service.sync_all()
        except Exception:
            log.exception("Periodic sync failed")
        await asyncio.sleep(SYNC_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_periodic_sync_loop())
    yield
    task.cancel()


app = FastAPI(
    title="Statistic-site API",
    description="Infrastructure analytics: CMDB vs Zabbix comparison, VM resource analysis, cluster optimization",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(comparison.router, prefix="/api")
app.include_router(resources.router, prefix="/api")
app.include_router(clusters.router, prefix="/api")
app.include_router(physical_servers.router, prefix="/api")
app.include_router(sync.router, prefix="/api")


@app.get("/api/health", tags=["health"])
async def health():
    return {"status": "ok"}
