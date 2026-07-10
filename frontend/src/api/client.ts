const BASE = import.meta.env.VITE_API_URL ?? "";

async function apiFetch<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`API ${path} → ${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

async function apiPost<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { method: "POST" });
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
  cmdbStats: (days?: number) =>
    apiFetch<CmdbStatsResponse>(`/api/cmdb-stats${days ? `?days=${days}` : ""}`),
  zabbixProblems: (dateFrom?: string, dateTill?: string) => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTill) params.set("date_till", dateTill);
    const qs = params.toString();
    return apiFetch<ZabbixProblemsResponse>(`/api/zabbix/problems${qs ? `?${qs}` : ""}`);
  },
};
