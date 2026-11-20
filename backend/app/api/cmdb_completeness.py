"""CMDB Data Completeness: field fill-rate per CI type from cached CMDB data."""
from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import (
    CmdbCompletenessField,
    CmdbCompletenessResponse,
    CmdbCompletenessType,
)
from app.services import db, response_cache

router = APIRouter(tags=["cmdb"])

_CACHE_TTL = 300

_VM_FIELDS: list[tuple[str, str]] = [
    ("fqdn",       "FQDN"),
    ("primary_ip", "Primary IP"),
    ("status",     "Status"),
    ("os_family",  "OS"),
    ("cluster",    "Cluster"),
    ("vcpu",       "vCPU"),
    ("vram_gb",    "vRAM"),
]

_PHYS_FIELDS: list[tuple[str, str]] = [
    ("fqdn",          "FQDN"),
    ("primary_ip",    "Primary IP"),
    ("status",        "Status"),
    ("location",      "Location"),
    ("manufacturer",  "Manufacturer"),
    ("model",         "Model"),
    ("cpu_count",     "CPU Count"),
    ("ram_gb",        "RAM GB"),
]


def _compute(
    items: list[dict],
    fields: list[tuple[str, str]],
    ci_type: str,
    label: str,
) -> CmdbCompletenessType:
    total = len(items)
    if total == 0:
        return CmdbCompletenessType(ci_type=ci_type, label=label, total=0, fields=[], overall_pct=0.0)

    field_stats: list[CmdbCompletenessField] = []
    for key, field_label in fields:
        filled = sum(1 for it in items if it.get(key) not in (None, "", 0))
        pct = round(filled / total * 100, 1)
        field_stats.append(CmdbCompletenessField(
            key=key, label=field_label, filled=filled, total=total, pct=pct,
        ))

    overall = round(sum(f.pct for f in field_stats) / len(field_stats), 1) if field_stats else 0.0
    return CmdbCompletenessType(
        ci_type=ci_type, label=label, total=total, fields=field_stats, overall_pct=overall,
    )


@router.get("/cmdb/completeness", response_model=CmdbCompletenessResponse)
async def get_cmdb_completeness() -> CmdbCompletenessResponse:
    """Field-level fill-rate for VMs and Physical Servers from CMDB cache."""
    cached = response_cache.get("cmdb-completeness", ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    types: list[CmdbCompletenessType] = []
    synced_at: str | None = None

    vms_cached = db.get("vms")
    if vms_cached:
        vms, synced_at = vms_cached
        types.append(_compute(vms, _VM_FIELDS, "vm", "Віртуальні машини"))

    phys_cached = db.get("physical_servers")
    if phys_cached:
        types.append(_compute(phys_cached[0], _PHYS_FIELDS, "physical", "Фізичні сервери"))

    result = CmdbCompletenessResponse(types=types, synced_at=synced_at)
    response_cache.put("cmdb-completeness", result)
    return result
