from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import comparison, resources, clusters
from app.config import settings

app = FastAPI(
    title="Statistic-site API",
    description="Infrastructure analytics: CMDB vs Zabbix comparison, VM resource analysis, cluster optimization",
    version="1.0.0",
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


@app.get("/api/health", tags=["health"])
async def health():
    return {"status": "ok"}
