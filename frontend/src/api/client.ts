const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

async function apiFetch<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`API ${path} → ${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

export interface ComparisonItem {
  name: string;
  fqdn: string | null;
  cmdb_status: string | null;
  zabbix_status: string | null;
  comparison_status: "both" | "cmdb_only" | "zabbix_only";
}

export interface ComparisonResponse {
  total: number;
  monitored: number;
  cmdb_only: number;
  zabbix_only: number;
  items: ComparisonItem[];
}

export interface ResourceItem {
  name: string;
  fqdn: string | null;
  cluster: string | null;
  os_family: string | null;
  vcpu: number | null;
  vram_gb: number | null;
  avg_cpu_pct: number | null;
  avg_ram_pct: number | null;
  avg_disk_free_pct: number | null;
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
  recommendation: string | null;
}

export interface ClusterResponse {
  total_clusters: number;
  mixed_clusters: number;
  total_current_licenses: number;
  total_optimized_licenses: number;
  total_savings: number;
  items: ClusterItem[];
}

export const api = {
  comparison: () => apiFetch<ComparisonResponse>("/api/comparison"),
  resources: (days?: number) =>
    apiFetch<ResourceResponse>(`/api/resources${days ? `?period_days=${days}` : ""}`),
  clusters: () => apiFetch<ClusterResponse>("/api/clusters"),
};
