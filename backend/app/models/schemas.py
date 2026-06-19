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
    zabbix_name: str | None = None
    cmdb_status: str | None = None
    zabbix_status: str | None = None
    comparison_status: ComparisonStatus
    os_family: str | None = None
    cluster: str | None = None
    primary_ip: str | None = None


class ComparisonResponse(BaseModel):
    total: int
    monitored: int
    cmdb_only: int
    zabbix_only: int
    items: list[ComparisonItem]
    synced_at: str | None = None


# ── Resource Analysis ─────────────────────────────────────────────────────────

ResourceStatus = Literal["optimal", "oversized", "undersized", "no_data"]


class ResourceItem(BaseModel):
    name: str
    fqdn: str | None = None
    primary_ip: str | None = None
    cluster: str | None = None
    os_family: str | None = None
    vcpu: int | None = None
    vram_gb: int | None = None
    avg_cpu_pct: float | None = None
    max_cpu_pct: float | None = None
    avg_ram_pct: float | None = None
    max_ram_pct: float | None = None
    avg_disk_free_pct: float | None = None
    min_disk_free_pct: float | None = None
    vc_avg_cpu_pct: float | None = None
    vc_max_cpu_pct: float | None = None
    vc_avg_ram_pct: float | None = None
    vc_max_ram_pct: float | None = None
    avg_disk_used_pct: float | None = None
    max_disk_used_pct: float | None = None
    avg_disk_io_kbps: float | None = None
    max_disk_io_kbps: float | None = None
    resource_status: ResourceStatus
    recommendations: list[str]


class ResourceResponse(BaseModel):
    total: int
    optimal: int
    oversized: int
    undersized: int
    no_data: int
    items: list[ResourceItem]
    synced_at: str | None = None


class ResourceHistoryPoint(BaseModel):
    timestamp: int
    cpu_pct: float | None = None
    ram_pct: float | None = None
    disk_free_pct: float | None = None


class ResourceHistoryVCenterPoint(BaseModel):
    timestamp: int
    vc_cpu_pct: float | None = None
    vc_ram_pct: float | None = None
    disk_used_pct: float | None = None
    disk_io_kbps: float | None = None


class ResourceHistoryResponse(BaseModel):
    name: str
    points: list[ResourceHistoryPoint]
    vcenter_points: list[ResourceHistoryVCenterPoint] = []


# ── Physical Servers ──────────────────────────────────────────────────────────

class PhysicalServerItem(BaseModel):
    name: str
    fqdn: str | None = None
    primary_ip: str | None = None
    location: str | None = None
    manufacturer: str | None = None
    model: str | None = None
    cpu_count: int | None = None
    cpu_cores: int | None = None
    ram_gb: int | None = None
    storage_config: str | None = None
    avg_cpu_pct: float | None = None
    max_cpu_pct: float | None = None
    avg_ram_pct: float | None = None
    max_ram_pct: float | None = None
    avg_disk_free_pct: float | None = None
    min_disk_free_pct: float | None = None
    resource_status: ResourceStatus
    is_monitored: bool


class PhysicalServerResponse(BaseModel):
    total: int
    monitored: int
    items: list[PhysicalServerItem]
    synced_at: str | None = None


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
    current_dc_cost_usd: float
    optimized_dc_cost_usd: float
    savings_usd: float
    recommendation: str | None = None


class ClusterResponse(BaseModel):
    total_clusters: int
    mixed_clusters: int
    total_current_licenses: int
    total_optimized_licenses: int
    total_savings: int
    total_current_cost_usd: float
    total_optimized_cost_usd: float
    total_savings_usd: float
    items: list[ClusterItem]
    synced_at: str | None = None


# ── Cluster Forecast ───────────────────────────────────────────────────────────

class ClusterForecastPoint(BaseModel):
    timestamp: int
    avg_cpu_pct: float | None = None
    avg_ram_pct: float | None = None


class ClusterForecastResponse(BaseModel):
    name: str
    points: list[ClusterForecastPoint]
    cpu_days_to_80: int | None = None
    ram_days_to_80: int | None = None
