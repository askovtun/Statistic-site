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
};
