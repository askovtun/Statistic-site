from fastapi import APIRouter, HTTPException, Query
from app.models.schemas import ClusterForecastPoint, ClusterForecastResponse, ClusterResponse
from app.services import analyzer, db, metrics_store

router = APIRouter(tags=["clusters"])

_NOT_SYNCED = "Дані ще не синхронізовано. Натисніть «Оновити дані»."


@router.get("/clusters", response_model=ClusterResponse)
async def get_clusters():
    """Analyze VM clusters and provide Windows Datacenter licensing optimization."""
    clusters_cached = db.get("clusters")
    vms_cached = db.get("vms")
    if clusters_cached is None or vms_cached is None:
        raise HTTPException(status_code=503, detail=_NOT_SYNCED)

    clusters, updated_at = clusters_cached
    vms, _ = vms_cached
    response = analyzer.build_clusters(clusters, vms)
    response.synced_at = updated_at
    return response


def _linear_days_to_threshold(points: list[dict], key: str, threshold: float) -> int | None:
    """Days from the last data point until `key` reaches `threshold`, via linear regression.

    Returns None if the trend is flat/declining or if there is insufficient data.
    """
    values = [(i, p[key]) for i, p in enumerate(points) if p.get(key) is not None]
    if len(values) < 5:
        return None
    x_vals = [v[0] for v in values]
    y_vals = [v[1] for v in values]
    n = len(x_vals)
    x_mean = sum(x_vals) / n
    y_mean = sum(y_vals) / n
    num = sum((x - x_mean) * (y - y_mean) for x, y in zip(x_vals, y_vals))
    den = sum((x - x_mean) ** 2 for x in x_vals)
    if den == 0:
        return None
    slope = num / den  # % per index step (1 day)
    if slope <= 0:
        return None
    current = y_vals[-1]
    if current >= threshold:
        return 0
    days = (threshold - current) / slope
    return int(days) if days < 730 else None  # cap at 2 years


@router.get("/clusters/{name}/forecast", response_model=ClusterForecastResponse)
async def get_cluster_forecast(
    name: str,
    period_days: int = Query(default=90, description="Кількість днів для аналізу тренду"),
):
    """Daily CPU/RAM trend for a cluster (vCenter averages across all VMs) + linear forecast."""
    vms_cached = db.get("vms")
    moid_map_cached = db.get("vm_moid_map")
    if vms_cached is None:
        raise HTTPException(status_code=503, detail=_NOT_SYNCED)

    vms, _ = vms_cached
    vm_moid_map = moid_map_cached[0] if moid_map_cached else {}

    cluster_vms = [v for v in vms if v.get("cluster") == name]
    if not cluster_vms:
        raise HTTPException(status_code=404, detail=f"Кластер '{name}' не знайдено або порожній")

    moids = [vm_moid_map[v["name"]] for v in cluster_vms if v.get("name") in vm_moid_map]
    if not moids:
        return ClusterForecastResponse(name=name, points=[])

    raw = metrics_store.get_cluster_daily_trend(moids, period_days)
    points = [ClusterForecastPoint(**p) for p in raw]

    cpu_days = _linear_days_to_threshold(raw, "avg_cpu_pct", 80.0)
    ram_days = _linear_days_to_threshold(raw, "avg_ram_pct", 80.0)

    return ClusterForecastResponse(
        name=name,
        points=points,
        cpu_days_to_80=cpu_days,
        ram_days_to_80=ram_days,
    )
