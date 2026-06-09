from __future__ import annotations
from typing import Literal
from pydantic import BaseModel


# ── Shared ────────────────────────────────────────────────────────────────────

class VMBase(BaseModel):
    name: str
    fqdn: str | None = None
    status: str | None = None


# ── Comparison ────────────────────────────────────────────────────────────────

ComparisonStatus = Literal["both", "cmdb_only", "zabbix_only"]


class ComparisonItem(BaseModel):
    name: str
    fqdn: str | None = None
    cmdb_status: str | None = None
    zabbix_status: str | None = None
    comparison_status: ComparisonStatus


class ComparisonResponse(BaseModel):
    total: int
    monitored: int
    cmdb_only: int
    zabbix_only: int
    items: list[ComparisonItem]


# ── Resource Analysis ─────────────────────────────────────────────────────────

ResourceStatus = Literal["optimal", "oversized", "undersized", "no_data"]


class ResourceItem(BaseModel):
    name: str
    fqdn: str | None = None
    cluster: str | None = None
    os_family: str | None = None
    vcpu: int | None = None
    vram_gb: int | None = None
    avg_cpu_pct: float | None = None
    avg_ram_pct: float | None = None
    avg_disk_free_pct: float | None = None
    resource_status: ResourceStatus
    recommendations: list[str]


class ResourceResponse(BaseModel):
    total: int
    optimal: int
    oversized: int
    undersized: int
    no_data: int
    items: list[ResourceItem]


# ── Cluster Optimization ──────────────────────────────────────────────────────

class ClusterItem(BaseModel):
    name: str
    host_count: int | None = None
    total_cpu_cores: int | None = None
    total_vms: int
    windows_vms: int
    linux_vms: int
    other_vms: int
    windows_pct: float
    linux_pct: float
    current_dc_licenses: int
    optimized_dc_licenses: int
    license_savings: int
    recommendation: str | None = None


class ClusterResponse(BaseModel):
    total_clusters: int
    mixed_clusters: int
    total_current_licenses: int
    total_optimized_licenses: int
    total_savings: int
    items: list[ClusterItem]
