"""Backup Coverage: which VMs/servers have backup monitoring in Zabbix."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from app.models.schemas import BackupCoverageItem, BackupCoverageResponse
from app.services import db, response_cache, zabbix_client

router = APIRouter(tags=["monitoring"])

_CACHE_TTL = 3600

# Substrings in Zabbix host group names that indicate backup monitoring
_BACKUP_GROUP_HINTS = ("backup", "veeam", "резервн", "бекап")


def _has_backup(groups: list[dict]) -> tuple[bool, str | None]:
    for g in groups:
        name = g.get("name", "").lower()
        if any(hint in name for hint in _BACKUP_GROUP_HINTS):
            return True, g.get("name")
    return False, None


@router.get("/backup/coverage", response_model=BackupCoverageResponse)
async def get_backup_coverage() -> BackupCoverageResponse:
    """Check which VMs and physical servers have backup-related Zabbix host groups."""
    cached = response_cache.get("backup-coverage", ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    # Build Zabbix host map {hostname.lower(): groups}
    zc = zabbix_client.ZabbixClient()
    zabbix_hosts = await zc.get_all_hosts()
    zabbix_by_name: dict[str, list[dict]] = {}
    for h in zabbix_hosts:
        for key in (h.get("host", ""), h.get("name", "")):
            if key:
                zabbix_by_name[key.lower()] = h.get("groups", [])

    vms_cached = db.get("vms")
    phys_cached = db.get("physical_servers")

    items: list[BackupCoverageItem] = []

    def _process(ci_list: list[dict], ci_type: str) -> None:
        for ci in ci_list:
            name = ci.get("name") or ""
            fqdn = ci.get("fqdn") or ""
            # Try to find in Zabbix by name or fqdn
            groups = (
                zabbix_by_name.get(name.lower())
                or zabbix_by_name.get(fqdn.lower())
                or []
            )
            has_bkp, bkp_group = _has_backup(groups)
            items.append(BackupCoverageItem(
                name=name,
                ci_type=ci_type,
                has_backup=has_bkp,
                backup_group=bkp_group,
                fqdn=fqdn or None,
                cluster=ci.get("cluster"),
                cmdb_status=ci.get("status"),
            ))

    if vms_cached:
        _process(vms_cached[0], "vm")
    if phys_cached:
        _process(phys_cached[0], "physical")

    covered = sum(1 for i in items if i.has_backup)
    total = len(items)
    coverage_pct = round(covered / total * 100, 1) if total else 0.0

    result = BackupCoverageResponse(
        total=total,
        covered=covered,
        not_covered=total - covered,
        coverage_pct=coverage_pct,
        items=sorted(items, key=lambda i: (not i.has_backup, i.ci_type, i.name)),
        fetched_at=datetime.now(timezone.utc).isoformat(),
    )
    response_cache.put("backup-coverage", result)
    return result
