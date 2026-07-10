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
    ci_type: Literal["vm", "physical"] = "vm"
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
    # VM-only counters (excludes physical servers and zabbix_only)
    total_vms: int = 0
    vm_monitored: int = 0
    vm_cmdb_only: int = 0
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
    trend_cpu_delta: float | None = None
    trend_ram_delta: float | None = None
    availability_pct: float | None = None
    recommended_vcpu: int | None = None
    recommended_vram_gb: int | None = None


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


# ── vCenter Health ─────────────────────────────────────────────────────────────

class VCenterHealthItem(BaseModel):
    name: str
    moid: str
    power_state: str
    boot_time: str | None = None
    cluster: str | None = None
    vcpu: int | None = None
    vram_gb: int | None = None
    cpu_ready_pct: float | None = None
    mem_balloon_kb: float | None = None
    mem_swapped_kb: float | None = None
    disk_used_pct: float | None = None
    snapshot_count: int = 0
    recommendations: list[str] = []


class VCenterSnapshotItem(BaseModel):
    vm_name: str
    name: str
    description: str = ""
    created_at: str
    age_days: int


class VCenterHealthResponse(BaseModel):
    total_vms: int
    powered_on: int
    powered_off: int
    with_cpu_ready_warn: int
    with_balloon: int
    with_swap: int
    with_snapshots: int
    items: list[VCenterHealthItem]
    synced_at: str | None = None


class VCenterSnapshotsResponse(BaseModel):
    total: int
    snapshots: list[VCenterSnapshotItem]


class VCenterHostItem(BaseModel):
    moid: str
    name: str
    cluster: str | None = None
    num_cpu_cores: int | None = None
    memory_gb: int | None = None
    power_state: str = "unknown"
    cpu_usage_pct: float | None = None
    mem_usage_pct: float | None = None
    vm_count: int = 0
    vms_with_data: int = 0
    avg_vm_cpu_ready_pct: float | None = None
    max_vm_cpu_ready_pct: float | None = None
    total_vcpus: int = 0
    cpu_overcommit_ratio: float | None = None
    status: str = "ok"


class VCenterHostsResponse(BaseModel):
    total_hosts: int
    powered_on: int
    hosts_with_ready_warn: int
    items: list[VCenterHostItem]
    synced_at: str | None = None


# ── OS Lifecycle Report ────────────────────────────────────────────────────────

OsStatus = Literal["supported", "ending_soon", "eol", "unknown"]


class OsServerItem(BaseModel):
    name: str
    ci_type: Literal["vm", "physical"] = "vm"
    os_raw: str | None = None       # OS name used for matching (from vCenter or CMDB)
    os_product: str | None = None
    os_vendor: str | None = None
    os_status: OsStatus = "unknown"
    eol_date: str | None = None
    days_until_eol: int | None = None
    cluster: str | None = None
    fqdn: str | None = None
    primary_ip: str | None = None
    os_from_tools: bool = False     # True = OS read from VMware Tools (guest), False = CMDB/config


class OsSummaryItem(BaseModel):
    os_raw: str
    os_product: str | None = None
    os_vendor: str | None = None
    os_status: OsStatus = "unknown"
    eol_date: str | None = None
    days_until_eol: int | None = None
    server_count: int = 0


class OsReportResponse(BaseModel):
    total_servers: int
    supported: int
    ending_soon: int
    eol: int
    unknown: int
    os_types: list[OsSummaryItem]
    servers: list[OsServerItem]
    synced_at: str | None = None


# ── CMDB Change Statistics ────────────────────────────────────────────────────

class CmdbTypeStats(BaseModel):
    ci_type: str
    added: int = 0
    updated: int = 0
    removed: int = 0
    total: int = 0


class CmdbDayStats(BaseModel):
    date: str
    added: int = 0
    updated: int = 0
    removed: int = 0
    total: int = 0
    breakdown: list[CmdbTypeStats] = []


class CmdbStatsResponse(BaseModel):
    days: list[CmdbDayStats]
    current_totals: dict[str, int] = {}
    synced_at: str | None = None


# ── Zabbix Problems ────────────────────────────────────────────────────────────

class ZabbixProblemItem(BaseModel):
    event_id: str
    name: str
    severity: int       # 0=Not classified … 5=Disaster
    clock: int          # unix timestamp
    acknowledged: bool
    suppressed: bool
    tags: list[dict[str, str]] = []


class ZabbixHostProblems(BaseModel):
    hostid: str
    host_name: str       # Zabbix display name
    host_technical: str  # technical hostname (host field)
    problems: list[ZabbixProblemItem]
    total: int
    max_severity: int    # highest severity among all problems
    disaster: int = 0
    high: int = 0
    average: int = 0
    warning: int = 0
    information: int = 0
    not_classified: int = 0
    latest_clock: int | None = None


class ZabbixProblemsResponse(BaseModel):
    total_problems: int
    total_hosts: int
    disaster: int = 0
    high: int = 0
    average: int = 0
    warning: int = 0
    information: int = 0
    not_classified: int = 0
    hosts: list[ZabbixHostProblems]
    fetched_at: str
