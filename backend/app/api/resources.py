from fastapi import APIRouter, HTTPException, Query
from app.models.schemas import ResourceResponse
from app.services import jira_client, zabbix_client, analyzer
from app.config import settings

router = APIRouter(tags=["resources"])


@router.get("/resources", response_model=ResourceResponse)
async def get_resources(
    period_days: int = Query(default=None, ge=1, le=365, description="Кількість днів для аналізу"),
):
    """Analyze VM resource utilization based on Zabbix metrics."""
    period = period_days or settings.metrics_period_days
    try:
        vms = await jira_client.get_all_vms()
        host_names = [
            v["name"] for v in vms if v.get("name")
        ]
        metrics = await zabbix_client.get_host_metrics(host_names, period)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return analyzer.build_resources(vms, metrics)
