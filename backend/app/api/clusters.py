from fastapi import APIRouter, HTTPException
from app.models.schemas import ClusterResponse
from app.services import jira_client, analyzer

router = APIRouter(tags=["clusters"])


@router.get("/clusters", response_model=ClusterResponse)
async def get_clusters():
    """Analyze VM clusters and provide Windows Datacenter licensing optimization."""
    try:
        import asyncio
        clusters, vms = await asyncio.gather(
            jira_client.get_all_clusters(),
            jira_client.get_all_vms(),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return analyzer.build_clusters(clusters, vms)
