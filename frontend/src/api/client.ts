const BASE = import.meta.env.VITE_API_URL ?? "";

const FETCH_OPTS: RequestInit = { credentials: "same-origin" };

async function apiFetch<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, FETCH_OPTS);
  if (!r.ok) throw new Error(`API ${path} → ${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

async function apiPost<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { ...FETCH_OPTS, method: "POST" });
  if (!r.ok) throw new Error(`API ${path} → ${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

async function apiPostJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    ...FETCH_OPTS,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`API ${path} → ${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

export interface ComparisonItem {
  name: string;
  ci_type: "vm" | "physical";
  fqdn: string | null;
  zabbix_name: string | null;
  cmdb_status: string | null;
  zabbix_status: string | null;
  comparison_status: "both" | "cmdb_only" | "zabbix_only";
  os_family: string | null;
  cluster: string | null;
  primary_ip: string | null;
}

export interface ComparisonResponse {
  total: number;
  monitored: number;
  cmdb_only: number;
  zabbix_only: number;
  total_vms: number;
  vm_monitored: number;
  vm_cmdb_only: number;
  items: ComparisonItem[];
  synced_at: string | null;
}

export interface ResourceItem {
  name: string;
  fqdn: string | null;
  primary_ip: string | null;
  cluster: string | null;
  os_family: string | null;
  vcpu: number | null;
  vram_gb: number | null;
  avg_cpu_pct: number | null;
  max_cpu_pct: number | null;
  avg_ram_pct: number | null;
  max_ram_pct: number | null;
  avg_disk_free_pct: number | null;
  min_disk_free_pct: number | null;
  vc_avg_cpu_pct: number | null;
  vc_max_cpu_pct: number | null;
  vc_avg_ram_pct: number | null;
  vc_max_ram_pct: number | null;
  avg_disk_used_pct: number | null;
  max_disk_used_pct: number | null;
  avg_disk_io_kbps: number | null;
  max_disk_io_kbps: number | null;
  resource_status: "optimal" | "oversized" | "undersized" | "no_data";
  recommendations: string[];
  trend_cpu_delta: number | null;
  trend_ram_delta: number | null;
  availability_pct: number | null;
  recommended_vcpu: number | null;
  recommended_vram_gb: number | null;
}

export interface ResourceResponse {
  total: number;
  optimal: number;
  oversized: number;
  undersized: number;
  no_data: number;
  items: ResourceItem[];
  synced_at: string | null;
}

export interface ClusterItem {
  name: string;
  host_count: number | null;
  total_cpu_cores: number | null;
  total_vms: number;
  windows_vms: number;
  linux_vms: number;
  other_vms: number;
  windows_pct: number;
  linux_pct: number;
  current_dc_licenses: number;
  optimized_dc_licenses: number;
  license_savings: number;
  current_dc_cost_usd: number;
  optimized_dc_cost_usd: number;
  savings_usd: number;
  recommendation: string | null;
}

export interface ClusterResponse {
  total_clusters: number;
  mixed_clusters: number;
  total_current_licenses: number;
  total_optimized_licenses: number;
  total_savings: number;
  total_current_cost_usd: number;
  total_optimized_cost_usd: number;
  total_savings_usd: number;
  items: ClusterItem[];
  synced_at: string | null;
}

export interface ResourceHistoryPoint {
  timestamp: number;
  cpu_pct: number | null;
  ram_pct: number | null;
  disk_free_pct: number | null;
  disk_used_pct: number | null;
}

export interface ResourceHistoryVCenterPoint {
  timestamp: number;
  vc_cpu_pct: number | null;
  vc_ram_pct: number | null;
  disk_used_pct: number | null;
  disk_io_kbps: number | null;
}

export interface ResourceHistoryResponse {
  name: string;
  points: ResourceHistoryPoint[];
  vcenter_points: ResourceHistoryVCenterPoint[];
}

export interface PhysicalServerItem {
  name: string;
  fqdn: string | null;
  primary_ip: string | null;
  location: string | null;
  manufacturer: string | null;
  model: string | null;
  cpu_count: number | null;
  cpu_cores: number | null;
  ram_gb: number | null;
  storage_config: string | null;
  avg_cpu_pct: number | null;
  max_cpu_pct: number | null;
  avg_ram_pct: number | null;
  max_ram_pct: number | null;
  avg_disk_free_pct: number | null;
  min_disk_free_pct: number | null;
  resource_status: "optimal" | "oversized" | "undersized" | "no_data";
  is_monitored: boolean;
}

export interface PhysicalServerResponse {
  total: number;
  monitored: number;
  items: PhysicalServerItem[];
  synced_at: string | null;
}

export interface ClusterForecastPoint {
  timestamp: number;
  avg_cpu_pct: number | null;
  avg_ram_pct: number | null;
}

export interface ClusterForecastResponse {
  name: string;
  points: ClusterForecastPoint[];
  cpu_days_to_80: number | null;
  ram_days_to_80: number | null;
}

export interface SyncStatus {
  in_progress: boolean;
  synced_at: string | null;
}

export interface SyncTriggerResponse {
  status: "started" | "already_running";
}

export interface VCenterHealthItem {
  name: string;
  moid: string;
  power_state: string;
  boot_time: string | null;
  cluster: string | null;
  vcpu: number | null;
  vram_gb: number | null;
  cpu_ready_pct: number | null;
  mem_balloon_kb: number | null;
  mem_swapped_kb: number | null;
  disk_used_pct: number | null;
  snapshot_count: number;
  recommendations: string[];
}

export interface VCenterHostItem {
  moid: string;
  name: string;
  cluster: string | null;
  num_cpu_cores: number | null;
  memory_gb: number | null;
  power_state: string;
  cpu_usage_pct: number | null;
  mem_usage_pct: number | null;
  vm_count: number;
  vms_with_data: number;
  avg_vm_cpu_ready_pct: number | null;
  max_vm_cpu_ready_pct: number | null;
  total_vcpus: number;
  cpu_overcommit_ratio: number | null;
  status: "ok" | "warning" | "critical";
}

export interface VCenterHostsResponse {
  total_hosts: number;
  powered_on: number;
  hosts_with_ready_warn: number;
  items: VCenterHostItem[];
  synced_at: string | null;
}

export interface VCenterHealthResponse {
  total_vms: number;
  powered_on: number;
  powered_off: number;
  with_cpu_ready_warn: number;
  with_balloon: number;
  with_swap: number;
  with_snapshots: number;
  items: VCenterHealthItem[];
  synced_at: string | null;
}

export interface VCenterSnapshotItem {
  vm_name: string;
  name: string;
  description: string;
  created_at: string;
  age_days: number;
  cluster: string | null;
}

export interface VCenterSnapshotsResponse {
  total: number;
  snapshots: VCenterSnapshotItem[];
}

// ── OS Lifecycle Report ───────────────────────────────────────────────────────

export type OsStatus = "supported" | "ending_soon" | "eol" | "unknown";

export interface OsServerItem {
  name: string;
  ci_type: "vm" | "physical";
  os_raw: string | null;
  os_product: string | null;
  os_vendor: string | null;
  os_status: OsStatus;
  eol_date: string | null;
  days_until_eol: number | null;
  cluster: string | null;
  fqdn: string | null;
  primary_ip: string | null;
  os_from_tools: boolean;
  [key: string]: unknown;
}

export interface OsSummaryItem {
  os_raw: string;
  os_product: string | null;
  os_vendor: string | null;
  os_status: OsStatus;
  eol_date: string | null;
  days_until_eol: number | null;
  server_count: number;
}

export interface OsReportResponse {
  total_servers: number;
  supported: number;
  ending_soon: number;
  eol: number;
  unknown: number;
  os_types: OsSummaryItem[];
  servers: OsServerItem[];
  synced_at: string | null;
}

// ── OS Progress ───────────────────────────────────────────────────────────────

export interface OsProgressItem {
  os_raw: string;
  os_product: string | null;
  os_vendor: string | null;
  eol_date: string | null;
  current_status: OsStatus;
  current_count: number;
  baseline_status: OsStatus | null;
  baseline_count: number | null;
  delta: number | null;
}

export interface OsUpgradedServerItem {
  name: string;
  old_status: OsStatus;
  new_status: OsStatus;
  os_product: string | null;
  os_raw: string | null;
  cluster: string | null;
  fqdn: string | null;
  primary_ip: string | null;
}

export interface OsProgressResponse {
  baseline_taken_at: string | null;
  baseline_label: string | null;
  baseline_total: number | null;
  baseline_eol: number | null;
  baseline_ending_soon: number | null;
  baseline_supported: number | null;
  baseline_unknown: number | null;
  current_total: number;
  current_eol: number;
  current_ending_soon: number;
  current_supported: number;
  current_unknown: number;
  eol_delta: number | null;
  ending_soon_delta: number | null;
  supported_delta: number | null;
  items: OsProgressItem[];
  upgraded_servers: OsUpgradedServerItem[];
}

// ── Security Dashboard ────────────────────────────────────────────────────────

export interface SecurityServerItem {
  name: string;
  ci_type: string;
  cluster: string | null;
  fqdn: string | null;
  primary_ip: string | null;
  os_raw: string | null;
  os_product: string | null;
  os_status: string | null;
  eol_date: string | null;
  days_until_eol: number | null;
}

export interface SecurityDashboardResponse {
  eol_count: number;
  ending_soon_count: number;
  unmonitored_vm_count: number;
  unmonitored_phys_count: number;
  unknown_os_count: number;
  no_version_count: number;
  eol_items: SecurityServerItem[];
  ending_soon_items: SecurityServerItem[];
  unmonitored_vms: SecurityServerItem[];
  unmonitored_phys: SecurityServerItem[];
  unknown_os_items: SecurityServerItem[];
  no_version_items: SecurityServerItem[];
  synced_at: string | null;
}

// ── Disk Space Forecast ───────────────────────────────────────────────────────

export interface DiskForecastItem {
  name: string;
  cluster: string | null;
  fqdn: string | null;
  primary_ip: string | null;
  current_free_pct: number | null;
  min_free_pct: number | null;
  days_until_full: number | null;
  trend_pct_per_day: number | null;
  data_points: number;
}

export interface DiskForecastResponse {
  total: number;
  critical: number;
  warning: number;
  items: DiskForecastItem[];
  synced_at: string | null;
  period_days: number;
}

// ── Disk Analytics ────────────────────────────────────────────────────────────

export interface DiskReclamationItem {
  name: string;
  cluster: string | null;
  fqdn: string | null;
  primary_ip: string | null;
  avg_free_pct: number;
  min_free_pct: number;
  variance_pct: number;
  data_points: number;
}

export interface DiskAnomalyItem {
  name: string;
  cluster: string | null;
  fqdn: string | null;
  primary_ip: string | null;
  current_free_pct: number | null;
  start_free_pct: number | null;
  drop_pct: number | null;
  recent_slope: number | null;
  hist_slope: number | null;
  acceleration: number | null;
  data_points: number;
}

export interface DiskFleetSummary {
  total_vms_with_data: number;
  critical_count: number;
  warning_count: number;
  ok_count: number;
  reclamation_count: number;
  anomaly_count: number;
}

export interface DiskAnalyticsResponse {
  fleet: DiskFleetSummary;
  reclamation: DiskReclamationItem[];
  anomalies: DiskAnomalyItem[];
  synced_at: string | null;
  period_days: number;
}

// ── Network Channels ──────────────────────────────────────────────────────────

export interface ChannelIface {
  ifname: string;
  itemid_in: string;
  itemid_out: string | null;
  last_in: number | null;
  last_out: number | null;
  lastclock: number | null;
}

export interface ChannelHost {
  hostid: string;
  name: string;
  interfaces: ChannelIface[];
}

export interface ChannelHostsResponse {
  hosts: ChannelHost[];
  fetched_at: string;
}

export interface ChannelPoint {
  clock: number;
  in_bps: number | null;
  out_bps: number | null;
}

export interface ChannelHistoryResponse {
  hostid: string;
  ifname: string;
  points: ChannelPoint[];
  fetched_at: string;
}

// ── VM Config Changes ─────────────────────────────────────────────────────────

export interface VmChangeItem {
  id: number;
  name: string;
  change_type: string;
  old_value: string | null;
  new_value: string | null;
  detected_at: string;
}

export interface VmChangesResponse {
  total: number;
  period_days: number;
  items: VmChangeItem[];
}

// ── Topology ──────────────────────────────────────────────────────────────────

export interface TopologyVmItem {
  name: string;
  power_state: string;
  vcpu: number | null;
  vram_gb: number | null;
}

export interface TopologyHostItem {
  moid: string;
  name: string;
  num_cpu_cores: number | null;
  memory_gb: number | null;
  cpu_usage_pct: number | null;
  mem_usage_pct: number | null;
  vm_count: number;
  powered_on: number;
  vms: TopologyVmItem[];
}

export interface TopologyClusterItem {
  name: string;
  host_count: number;
  vm_count: number;
  powered_on: number;
  status: string;
  host_cpu_pct: number | null;
  host_ram_pct: number | null;
  hosts: TopologyHostItem[];
}

export interface TopologyResponse {
  total_clusters: number;
  total_hosts: number;
  total_vms: number;
  total_powered_on: number;
  clusters: TopologyClusterItem[];
  synced_at: string | null;
}

// ── CMDB vs vCenter Diff ──────────────────────────────────────────────────────

export interface CmdbVcenterSyncResult {
  updated: number;
  skipped: number;
  cluster_skipped: number;
  errors: { name: string; error: string }[];
}

export interface CmdbVcenterDiffItem {
  name: string;
  ci_type: "vm" | "physical";
  jira_id: string | null;
  fqdn: string | null;
  primary_ip: string | null;
  in_vcenter: boolean;
  cmdb_vcpu: number | null;
  cmdb_vram_gb: number | null;
  cmdb_cluster: string | null;
  cmdb_status: string | null;
  cmdb_os: string | null;
  vc_vcpu: number | null;
  vc_vram_gb: number | null;
  vc_cluster: string | null;
  vc_power_state: string | null;
  vc_os: string | null;
  vcpu_diff: boolean;
  vram_diff: boolean;
  cluster_diff: boolean;
  diff_count: number;
}

export interface CmdbVcenterDiffResponse {
  total: number;
  matched: number;
  cmdb_only: number;
  with_diff: number;
  vcpu_diff_count: number;
  vram_diff_count: number;
  cluster_diff_count: number;
  items: CmdbVcenterDiffItem[];
  synced_at: string | null;
}

// ── CMDB Change Statistics ────────────────────────────────────────────────────

export interface CmdbTypeStats {
  ci_type: string;
  added: number;
  updated: number;
  removed: number;
  total: number;
}

export interface CmdbDayStats {
  date: string;
  added: number;
  updated: number;
  removed: number;
  total: number;
  breakdown: CmdbTypeStats[];
}

export interface CmdbStatsResponse {
  days: CmdbDayStats[];
  current_totals: Record<string, number>;
  synced_at: string | null;
}

// ── VM Uptime ─────────────────────────────────────────────────────────────────

export interface UptimeItem {
  name: string;
  power_state: string;
  boot_time: string | null;
  uptime_days: number | null;
  cluster: string | null;
}

export interface UptimeResponse {
  total: number;
  powered_on: number;
  powered_off: number;
  long_running: number;
  items: UptimeItem[];
  synced_at: string | null;
}

// ── Decommission Candidates ───────────────────────────────────────────────────

export interface DecommissionItem {
  name: string;
  power_state: string;
  cmdb_status: string | null;
  in_zabbix: boolean;
  cluster: string | null;
  fqdn: string | null;
  primary_ip: string | null;
  decommission_score: number;
  reasons: string[];
}

export interface DecommissionResponse {
  total: number;
  items: DecommissionItem[];
  synced_at: string | null;
}

// ── Decommissioned CIs ────────────────────────────────────────────────────────

export interface DecommissionedCIItem {
  name: string;
  ci_type: "vm" | "physical";
  cmdb_status: string | null;
  fqdn: string | null;
  primary_ip: string | null;
  os_family: string | null;
  cluster: string | null;
  power_state: string;
  in_zabbix: boolean;
  jira_updated: string | null;
}

export interface DecommissionedResponse {
  total_vms: number;
  total_physical: number;
  items: DecommissionedCIItem[];
  synced_at: string | null;
}

// ── Monitoring Coverage ───────────────────────────────────────────────────────

export interface CoveragePoint {
  date: string;
  vm_total: number;
  vm_monitored: number;
  vm_pct: number;
  phys_total: number;
  phys_monitored: number;
  phys_pct: number;
}

export interface CoverageResponse {
  current_vm_pct: number | null;
  current_phys_pct: number | null;
  vm_total: number;
  vm_monitored: number;
  phys_total: number;
  phys_monitored: number;
  history: CoveragePoint[];
  synced_at: string | null;
}

export interface CapacityClusterItem {
  name: string;
  host_count: number;
  physical_cpu_cores: number | null;
  physical_ram_gb: number | null;
  host_cpu_pct: number | null;
  host_ram_pct: number | null;
  allocated_vcpu: number;
  allocated_vram_gb: number;
  total_vms: number;
  powered_on_vms: number;
  vcpu_ratio: number | null;
  vram_ratio: number | null;
  avg_cpu_pct: number | null;
  avg_ram_pct: number | null;
  peak_cpu_pct: number | null;
  peak_ram_pct: number | null;
  free_cpu_cores: number | null;
  free_ram_gb: number | null;
  std_vms_can_fit: number | null;
  total_storage_gb: number | null;
  free_storage_gb: number | null;
  storage_used_pct: number | null;
  status: "ok" | "warning" | "critical" | "unknown";
}

export interface CapacityResponse {
  total_clusters: number;
  total_physical_cpu_cores: number;
  total_physical_ram_gb: number;
  total_storage_gb: number;
  critical_count: number;
  warning_count: number;
  items: CapacityClusterItem[];
  synced_at: string | null;
  period_days: number;
}

export interface ZabbixProblemItem {
  event_id: string;
  name: string;
  severity: number;   // 0=Not classified, 1=Info, 2=Warning, 3=Average, 4=High, 5=Disaster
  clock: number;      // unix timestamp
  acknowledged: boolean;
  suppressed: boolean;
  tags: { tag: string; value: string }[];
}

export interface ZabbixHostProblems {
  hostid: string;
  host_name: string;
  host_technical: string;
  problems: ZabbixProblemItem[];
  total: number;
  max_severity: number;
  disaster: number;
  high: number;
  average: number;
  warning: number;
  information: number;
  not_classified: number;
  latest_clock: number | null;
}

export interface ZabbixProblemsResponse {
  total_problems: number;
  total_hosts: number;
  disaster: number;
  high: number;
  average: number;
  warning: number;
  information: number;
  not_classified: number;
  hosts: ZabbixHostProblems[];
  fetched_at: string;
}

// ── Zombie Servers ────────────────────────────────────────────────────────────

export type ZombieSignal = "low_cpu" | "low_ram" | "no_zabbix" | "no_metrics" | "wasted_alloc";

export interface ZombieServerItem {
  name: string;
  fqdn: string | null;
  primary_ip: string | null;
  cluster: string | null;
  os_family: string | null;
  vcpu: number | null;
  vram_gb: number | null;
  power_state: string;
  avg_cpu_pct: number | null;
  max_cpu_pct: number | null;
  avg_ram_pct: number | null;
  max_ram_pct: number | null;
  data_coverage_pct: number | null;
  in_zabbix: boolean;
  in_vcenter: boolean;
  zombie_score: number;
  signals: ZombieSignal[];
}

export interface ZombieServerResponse {
  total: number;
  score5: number;
  score4: number;
  score3: number;
  score2: number;
  score1: number;
  items: ZombieServerItem[];
  synced_at: string | null;
  period_days: number;
}

// ── vCenter New VMs ───────────────────────────────────────────────────────────

export interface VCenterNewVM {
  moid: string;
  vc_name: string;
  cmdb_name: string;
  guest_hostname: string | null;
  guest_ip: string | null;
  power_state: string | null;
  vcpu: number | null;
  vram_gb: number | null;
  cluster: string | null;
  os_full_name: string | null;
  created_at: string | null;
}

export interface VCenterNewVMsResponse {
  total_vcenter: number;
  not_in_cmdb: number;
  items: VCenterNewVM[];
  synced_at: string | null;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: { name: string; error: string }[];
}

export const api = {
  comparison: () => apiFetch<ComparisonResponse>("/api/comparison"),
  resources: (days?: number) =>
    apiFetch<ResourceResponse>(`/api/resources${days ? `?period_days=${days}` : ""}`),
  resourceHistory: (name: string, days?: number) =>
    apiFetch<ResourceHistoryResponse>(
      `/api/resources/${encodeURIComponent(name)}/history${days ? `?period_days=${days}` : ""}`
    ),
  clusters: () => apiFetch<ClusterResponse>("/api/clusters"),
  clusterForecast: (name: string, days?: number) =>
    apiFetch<ClusterForecastResponse>(
      `/api/clusters/${encodeURIComponent(name)}/forecast${days ? `?period_days=${days}` : ""}`
    ),
  physicalServers: (days?: number) =>
    apiFetch<PhysicalServerResponse>(
      `/api/physical-servers${days ? `?period_days=${days}` : ""}`
    ),
  physicalServerHistory: (name: string, days?: number) =>
    apiFetch<ResourceHistoryResponse>(
      `/api/physical-servers/${encodeURIComponent(name)}/history${days ? `?period_days=${days}` : ""}`
    ),
  syncStatus: () => apiFetch<SyncStatus>("/api/sync/status"),
  triggerSync: () => apiPost<SyncTriggerResponse>("/api/sync"),
  vcenterHealth: (days?: number) =>
    apiFetch<VCenterHealthResponse>(
      `/api/vcenter/health${days ? `?period_days=${days}` : ""}`
    ),
  vcenterHosts: (days?: number) =>
    apiFetch<VCenterHostsResponse>(
      `/api/vcenter/hosts${days ? `?period_days=${days}` : ""}`
    ),
  vcenterSnapshots: () => apiFetch<VCenterSnapshotsResponse>("/api/vcenter/snapshots"),
  refreshSnapshots: () => apiPost<VCenterSnapshotsResponse>("/api/vcenter/snapshots/refresh"),
  osReport: () => apiFetch<OsReportResponse>("/api/os-report"),
  osProgress: () => apiFetch<OsProgressResponse>("/api/os-progress"),
  setOsBaseline: (label?: string) =>
    apiPost<{ taken_at: string; total: number }>(
      `/api/os-progress/baseline${label ? `?label=${encodeURIComponent(label)}` : ""}`
    ),
  cmdbStats: (days?: number) =>
    apiFetch<CmdbStatsResponse>(`/api/cmdb-stats${days ? `?days=${days}` : ""}`),
  uptime: () => apiFetch<UptimeResponse>("/api/uptime"),
  decommissionCandidates: () => apiFetch<DecommissionResponse>("/api/decommission-candidates"),
  decommissioned: () => apiFetch<DecommissionedResponse>("/api/decommissioned"),
  monitoringCoverage: (days?: number) =>
    apiFetch<CoverageResponse>(`/api/monitoring-coverage${days ? `?days=${days}` : ""}`),
  capacity: (days?: number) =>
    apiFetch<CapacityResponse>(`/api/capacity${days ? `?period_days=${days}` : ""}`),
  securityDashboard: () => apiFetch<SecurityDashboardResponse>("/api/security-dashboard"),
  vmChanges: (days?: number) =>
    apiFetch<VmChangesResponse>(`/api/vm-changes${days ? `?days=${days}` : ""}`),
  topology: () => apiFetch<TopologyResponse>("/api/topology"),
  cmdbVcenterDiff: () => apiFetch<CmdbVcenterDiffResponse>("/api/cmdb-vcenter-diff"),
  cmdbVcenterSync: () => apiPost<CmdbVcenterSyncResult>("/api/cmdb-vcenter-sync"),
  zombieServers: (days?: number, minScore?: number) =>
    apiFetch<ZombieServerResponse>(
      `/api/zombie-servers?period_days=${days ?? 90}&min_score=${minScore ?? 1}`
    ),
  diskForecast: (periodDays?: number, warnDays?: number) =>
    apiFetch<DiskForecastResponse>(
      `/api/disk-forecast?period_days=${periodDays ?? 30}&warn_days=${warnDays ?? 90}`
    ),
  diskAnalytics: (periodDays?: number) =>
    apiFetch<DiskAnalyticsResponse>(
      `/api/disk-analytics?period_days=${periodDays ?? 30}`
    ),
  zabbixProblems: (dateFrom?: string, dateTill?: string) => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTill) params.set("date_till", dateTill);
    const qs = params.toString();
    return apiFetch<ZabbixProblemsResponse>(`/api/zabbix/problems${qs ? `?${qs}` : ""}`);
  },
  vcenterNewVMs: () => apiFetch<VCenterNewVMsResponse>("/api/vcenter-new-vms"),
  importVCenterVMs: (moids: string[]) =>
    apiPostJson<ImportResult>("/api/vcenter-new-vms/import", { moids }),
  channelHosts: () => apiFetch<ChannelHostsResponse>("/api/network/channels/hosts"),
  channelHistory: (hostid: string, ifname: string, itemidIn: string, itemidOut: string | null, hours: number) => {
    const p = new URLSearchParams({ hostid, ifname, itemid_in: itemidIn, hours: String(hours) });
    if (itemidOut) p.set("itemid_out", itemidOut);
    return apiFetch<ChannelHistoryResponse>(`/api/network/channels/history?${p}`);
  },
};
