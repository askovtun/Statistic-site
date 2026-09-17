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


# ── Capacity Planning ──────────────────────────────────────────────────────────

class CapacityClusterItem(BaseModel):
    name: str
    host_count: int = 0
    physical_cpu_cores: int | None = None
    physical_ram_gb: int | None = None
    # Instantaneous usage from ESXi quickStats (weighted avg across hosts)
    host_cpu_pct: float | None = None
    host_ram_pct: float | None = None
    # Allocated in CMDB (configured VM resources)
    allocated_vcpu: int = 0
    allocated_vram_gb: int = 0
    total_vms: int = 0
    powered_on_vms: int = 0
    vcpu_ratio: float | None = None
    vram_ratio: float | None = None
    # Historical avg/peak from vCenter metric_hourly
    avg_cpu_pct: float | None = None
    avg_ram_pct: float | None = None
    peak_cpu_pct: float | None = None
    peak_ram_pct: float | None = None
    # Derived free capacity (at 80% ceiling)
    free_cpu_cores: int | None = None
    free_ram_gb: int | None = None
    std_vms_can_fit: int | None = None
    # Datastore storage (from ClusterComputeResource.datastore summary)
    total_storage_gb: int | None = None
    free_storage_gb: int | None = None
    storage_used_pct: float | None = None
    status: str = "unknown"


class CapacityResponse(BaseModel):
    total_clusters: int
    total_physical_cpu_cores: int = 0
    total_physical_ram_gb: int = 0
    total_storage_gb: int = 0
    critical_count: int = 0
    warning_count: int = 0
    items: list[CapacityClusterItem]
    synced_at: str | None = None
    period_days: int = 30


class VCenterSnapshotItem(BaseModel):
    vm_name: str
    name: str
    description: str = ""
    created_at: str
    age_days: int
    cluster: str | None = None


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


class OsProgressItem(BaseModel):
    os_raw: str
    os_product: str | None = None
    os_vendor: str | None = None
    eol_date: str | None = None
    current_status: OsStatus
    current_count: int = 0
    baseline_status: OsStatus | None = None
    baseline_count: int | None = None
    delta: int | None = None          # current_count - baseline_count; negative = fewer servers


class OsUpgradedServerItem(BaseModel):
    name: str
    old_status: OsStatus
    new_status: OsStatus
    os_product: str | None = None
    os_raw: str | None = None
    cluster: str | None = None
    fqdn: str | None = None
    primary_ip: str | None = None


class OsProgressResponse(BaseModel):
    baseline_taken_at: str | None = None
    baseline_label: str | None = None
    baseline_total: int | None = None
    baseline_eol: int | None = None
    baseline_ending_soon: int | None = None
    baseline_supported: int | None = None
    baseline_unknown: int | None = None
    current_total: int = 0
    current_eol: int = 0
    current_ending_soon: int = 0
    current_supported: int = 0
    current_unknown: int = 0
    eol_delta: int | None = None           # negative = fewer EOL (good)
    ending_soon_delta: int | None = None
    supported_delta: int | None = None
    items: list[OsProgressItem] = []
    upgraded_servers: list[OsUpgradedServerItem] = []


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


# ── VM Uptime Report ──────────────────────────────────────────────────────────

class UptimeItem(BaseModel):
    name: str
    power_state: str
    boot_time: str | None = None
    uptime_days: int | None = None
    cluster: str | None = None


class UptimeResponse(BaseModel):
    total: int
    powered_on: int
    powered_off: int
    long_running: int   # uptime > 365 days
    items: list[UptimeItem]
    synced_at: str | None = None


# ── Decommission Candidates ────────────────────────────────────────────────────

class DecommissionedCIItem(BaseModel):
    name: str
    ci_type: Literal["vm", "physical"] = "vm"
    cmdb_status: str | None = None
    fqdn: str | None = None
    primary_ip: str | None = None
    os_family: str | None = None
    cluster: str | None = None     # VMs: cluster name; physical: location
    power_state: str = "unknown"   # poweredOn / poweredOff / unknown (VMs only)
    in_zabbix: bool = False
    jira_updated: str | None = None


class DecommissionedResponse(BaseModel):
    total_vms: int = 0
    total_physical: int = 0
    items: list[DecommissionedCIItem] = []
    synced_at: str | None = None


class DecommissionItem(BaseModel):
    name: str
    power_state: str
    cmdb_status: str | None = None
    in_zabbix: bool
    cluster: str | None = None
    fqdn: str | None = None
    primary_ip: str | None = None
    decommission_score: int     # 1..3 (how many criteria are met)
    reasons: list[str]


class DecommissionResponse(BaseModel):
    total: int
    items: list[DecommissionItem]
    synced_at: str | None = None


# ── Monitoring Coverage History ────────────────────────────────────────────────

class CoveragePoint(BaseModel):
    date: str
    vm_total: int
    vm_monitored: int
    vm_pct: float
    phys_total: int
    phys_monitored: int
    phys_pct: float


class CoverageResponse(BaseModel):
    current_vm_pct: float | None = None
    current_phys_pct: float | None = None
    vm_total: int = 0
    vm_monitored: int = 0
    phys_total: int = 0
    phys_monitored: int = 0
    history: list[CoveragePoint] = []
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


# ── CMDB vs vCenter Diff ──────────────────────────────────────────────────────

class CmdbVcenterDiffItem(BaseModel):
    name: str
    ci_type: str = "vm"
    jira_id: str | None = None
    fqdn: str | None = None
    primary_ip: str | None = None
    in_vcenter: bool = True
    # CMDB values
    cmdb_vcpu: int | None = None
    cmdb_vram_gb: int | None = None
    cmdb_cluster: str | None = None
    cmdb_status: str | None = None
    cmdb_os: str | None = None
    # vCenter values
    vc_vcpu: int | None = None
    vc_vram_gb: int | None = None
    vc_cluster: str | None = None
    vc_power_state: str | None = None
    vc_os: str | None = None
    # Diff flags
    vcpu_diff: bool = False
    vram_diff: bool = False
    cluster_diff: bool = False
    diff_count: int = 0


class CmdbVcenterDiffResponse(BaseModel):
    total: int
    matched: int
    cmdb_only: int
    with_diff: int
    vcpu_diff_count: int = 0
    vram_diff_count: int = 0
    cluster_diff_count: int = 0
    items: list[CmdbVcenterDiffItem]
    synced_at: str | None = None


# ── Security Dashboard ─────────────────────────────────────────────────────────

class SecurityServerItem(BaseModel):
    name: str
    ci_type: str = "vm"
    cluster: str | None = None
    fqdn: str | None = None
    primary_ip: str | None = None
    os_raw: str | None = None
    os_product: str | None = None
    os_status: str | None = None
    eol_date: str | None = None
    days_until_eol: int | None = None


class SecurityDashboardResponse(BaseModel):
    eol_count: int = 0
    ending_soon_count: int = 0
    unmonitored_vm_count: int = 0
    unmonitored_phys_count: int = 0
    unknown_os_count: int = 0
    no_version_count: int = 0
    eol_items: list[SecurityServerItem] = []
    ending_soon_items: list[SecurityServerItem] = []
    unmonitored_vms: list[SecurityServerItem] = []
    unmonitored_phys: list[SecurityServerItem] = []
    unknown_os_items: list[SecurityServerItem] = []
    no_version_items: list[SecurityServerItem] = []
    synced_at: str | None = None


# ── Disk Space Forecast ───────────────────────────────────────────────────────

class DiskReclamationItem(BaseModel):
    name: str
    cluster: str | None = None
    fqdn: str | None = None
    primary_ip: str | None = None
    avg_free_pct: float
    min_free_pct: float
    variance_pct: float
    data_points: int = 0


class DiskAnomalyItem(BaseModel):
    name: str
    cluster: str | None = None
    fqdn: str | None = None
    primary_ip: str | None = None
    current_free_pct: float | None = None
    start_free_pct: float | None = None
    drop_pct: float | None = None
    recent_slope: float | None = None
    hist_slope: float | None = None
    acceleration: float | None = None
    data_points: int = 0


class DiskFleetSummary(BaseModel):
    total_vms_with_data: int
    critical_count: int     # < 10% free
    warning_count: int      # 10–20% free
    ok_count: int           # > 20% free
    reclamation_count: int  # at default thresholds (avg_free ≥ 30%, σ ≤ 3%)
    anomaly_count: int      # at default threshold (drop ≥ 5%)


class DiskAnalyticsResponse(BaseModel):
    fleet: DiskFleetSummary
    reclamation: list[DiskReclamationItem]
    anomalies: list[DiskAnomalyItem]
    synced_at: str | None = None
    period_days: int


class DiskForecastItem(BaseModel):
    name: str
    cluster: str | None = None
    fqdn: str | None = None
    primary_ip: str | None = None
    current_free_pct: float | None = None
    min_free_pct: float | None = None
    days_until_full: int | None = None
    trend_pct_per_day: float | None = None
    data_points: int = 0


class DiskForecastResponse(BaseModel):
    total: int
    critical: int = 0
    warning: int = 0
    items: list[DiskForecastItem]
    synced_at: str | None = None
    period_days: int = 30


# ── VM Config Changes ──────────────────────────────────────────────────────────

class VmChangeItem(BaseModel):
    id: int
    name: str
    change_type: str  # 'added', 'removed', 'vcpu', 'vram_gb', 'cluster', 'status', 'os_family'
    old_value: str | None = None
    new_value: str | None = None
    detected_at: str  # ISO datetime


class VmChangesResponse(BaseModel):
    total: int
    period_days: int
    items: list[VmChangeItem]


# ── Topology ───────────────────────────────────────────────────────────────────

class TopologyVmItem(BaseModel):
    name: str
    power_state: str = "unknown"
    vcpu: int | None = None
    vram_gb: int | None = None


class TopologyHostItem(BaseModel):
    moid: str
    name: str
    num_cpu_cores: int | None = None
    memory_gb: int | None = None
    cpu_usage_pct: float | None = None
    mem_usage_pct: float | None = None
    vm_count: int = 0
    powered_on: int = 0
    vms: list[TopologyVmItem] = []


class TopologyClusterItem(BaseModel):
    name: str
    host_count: int = 0
    vm_count: int = 0
    powered_on: int = 0
    status: str = "unknown"
    host_cpu_pct: float | None = None
    host_ram_pct: float | None = None
    hosts: list[TopologyHostItem] = []


class TopologyResponse(BaseModel):
    total_clusters: int
    total_hosts: int
    total_vms: int
    total_powered_on: int
    clusters: list[TopologyClusterItem]
    synced_at: str | None = None


# ── Zombie Servers ─────────────────────────────────────────────────────────────

class ZombieServerItem(BaseModel):
    name: str
    fqdn: str | None = None
    primary_ip: str | None = None
    cluster: str | None = None
    os_family: str | None = None
    vcpu: int | None = None
    vram_gb: int | None = None
    power_state: str = "unknown"
    avg_cpu_pct: float | None = None
    max_cpu_pct: float | None = None   # peak CPU over the period
    avg_ram_pct: float | None = None
    max_ram_pct: float | None = None   # peak RAM over the period
    data_coverage_pct: float | None = None  # % of expected hourly buckets with data
    in_zabbix: bool = False
    in_vcenter: bool = False
    zombie_score: int = 0
    signals: list[str] = []   # low_cpu | low_ram | no_zabbix | no_metrics | wasted_alloc


class ZombieServerResponse(BaseModel):
    total: int
    score5: int = 0
    score4: int = 0
    score3: int = 0
    score2: int = 0
    score1: int = 0
    items: list[ZombieServerItem]
    synced_at: str | None = None
    period_days: int = 90
