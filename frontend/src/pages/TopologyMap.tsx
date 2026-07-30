import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api, type TopologyClusterItem, type TopologyHostItem, type TopologyVmItem } from "../api/client";

// ── Constants ─────────────────────────────────────────────────────────────────

const HOST_W        = 200;
const HOST_GAP      = 24;
const CLUSTER_H     = 90;
const COL_GAP       = 60;
const GRID_COL_GAP  = 60;
const GRID_ROW_GAP  = 180;
const COLS          = 3;
const ROWS_PER_PAGE = 2;
const PAGE_SIZE     = COLS * ROWS_PER_PAGE;

const STATUS_COLORS = {
  critical: { bg: "#fef2f2", border: "#fca5a5", text: "#b91c1c", dot: "#ef4444", badge: "bg-red-100 text-red-700 border-red-300" },
  warning:  { bg: "#fffbeb", border: "#fcd34d", text: "#92400e", dot: "#f59e0b", badge: "bg-amber-100 text-amber-700 border-amber-300" },
  ok:       { bg: "#f0fdf4", border: "#86efac", text: "#166534", dot: "#22c55e", badge: "bg-green-100 text-green-700 border-green-300" },
  unknown:  { bg: "#f9fafb", border: "#d1d5db", text: "#6b7280", dot: "#9ca3af", badge: "bg-gray-100 text-gray-600 border-gray-300" },
};

const STATUS_LABELS: Record<string, string> = {
  ok: "Норма", warning: "Увага", critical: "Критично", unknown: "Невідомо",
};

function pctColor(pct: number | null) {
  if (pct == null) return "#9ca3af";
  if (pct >= 80)   return "#ef4444";
  if (pct >= 65)   return "#f59e0b";
  return "#3b82f6";
}

// ── Shared usage bar (canvas nodes) ──────────────────────────────────────────

function UsageBar({ label, pct }: { label: string; pct: number | null }) {
  const color = pctColor(pct);
  const width = Math.min(100, Math.max(0, pct ?? 0));
  return (
    <div className="mb-1">
      <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
        <span>{label}</span>
        <span style={{ color }}>{pct != null ? `${pct}%` : "—"}</span>
      </div>
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className="h-1.5 rounded-full" style={{ width: `${width}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ── Usage bar (modal — taller, more readable) ─────────────────────────────────

function UsageBarLg({ label, pct }: { label: string; pct: number | null }) {
  const color = pctColor(pct);
  const width = Math.min(100, Math.max(0, pct ?? 0));
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs text-gray-600 mb-1">
        <span className="font-medium">{label}</span>
        <span className="font-semibold" style={{ color }}>{pct != null ? `${pct}%` : "—"}</span>
      </div>
      <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden">
        <div className="h-2.5 rounded-full transition-all" style={{ width: `${width}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ── Custom canvas nodes ────────────────────────────────────────────────────────

type ClusterNodeData = {
  cluster: TopologyClusterItem;
};

function ClusterNode({ data }: NodeProps) {
  const { cluster } = data as unknown as ClusterNodeData;
  const c = STATUS_COLORS[cluster.status as keyof typeof STATUS_COLORS] ?? STATUS_COLORS.unknown;
  return (
    <div
      style={{ background: c.bg, borderColor: c.border }}
      className="rounded-xl border-2 px-4 py-3 shadow-sm cursor-pointer hover:shadow-lg hover:scale-105 transition-all w-52 select-none"
    >
      <Handle type="source" position={Position.Bottom} style={{ background: c.dot, width: 8, height: 8 }} />
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.dot }} />
        <span className="font-bold text-sm text-gray-800 truncate">{cluster.name}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 text-xs text-gray-500">
        <span>{cluster.host_count} хостів</span>
        <span>{cluster.vm_count} VMs</span>
        <span className="text-green-600">{cluster.powered_on} увімк.</span>
        {cluster.host_cpu_pct != null && (
          <span style={{ color: pctColor(cluster.host_cpu_pct) }}>CPU {cluster.host_cpu_pct}%</span>
        )}
      </div>
      <p className="text-[10px] text-gray-400 mt-2 text-center">натисніть для деталей</p>
    </div>
  );
}

type HostNodeData = {
  host: TopologyHostItem;
  isSelected: boolean;
};

function HostNode({ data }: NodeProps) {
  const { host, isSelected } = data as unknown as HostNodeData;
  return (
    <div
      className="bg-white rounded-xl border-2 px-3 py-2.5 shadow-sm cursor-pointer hover:shadow-md transition-shadow select-none"
      style={{ width: HOST_W, borderColor: isSelected ? "#2563eb" : "#e5e7eb" }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "#9ca3af", width: 8, height: 8 }} />
      <p className="text-xs font-semibold text-gray-700 truncate mb-2" title={host.name}>
        {host.name.split(".")[0]}
      </p>
      <UsageBar label="CPU" pct={host.cpu_usage_pct} />
      <UsageBar label="RAM" pct={host.mem_usage_pct} />
      <div className="mt-1.5 flex justify-between text-[10px] text-gray-400">
        <span>{host.vm_count} VMs</span>
        <span className="text-green-600">{host.powered_on} увімк.</span>
      </div>
    </div>
  );
}

const nodeTypes = { cluster: ClusterNode, host: HostNode };

// ── Cluster Detail Modal ──────────────────────────────────────────────────────

function VmChip({ vm }: { vm: TopologyVmItem }) {
  const on = vm.power_state === "poweredOn";
  return (
    <div className="flex items-center gap-1.5 py-1 border-b border-gray-100 last:border-0">
      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${on ? "bg-green-400" : "bg-gray-300"}`} />
      <span className="text-xs text-gray-700 truncate flex-1 min-w-0">{vm.name}</span>
      {(vm.vcpu || vm.vram_gb) && (
        <span className="text-[10px] text-gray-400 shrink-0">
          {vm.vcpu ? `${vm.vcpu}c` : ""}
          {vm.vcpu && vm.vram_gb ? "/" : ""}
          {vm.vram_gb ? `${vm.vram_gb}G` : ""}
        </span>
      )}
    </div>
  );
}

function HostModalCard({ host, search }: { host: TopologyHostItem; search: string }) {
  const q = search.toLowerCase();
  const vms = q ? host.vms.filter(v => v.name.toLowerCase().includes(q)) : host.vms;
  const c = STATUS_COLORS[host.cpu_usage_pct != null && host.cpu_usage_pct >= 80 ? "critical"
    : host.cpu_usage_pct != null && host.cpu_usage_pct >= 65 ? "warning" : "ok"];

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
      {/* Host header */}
      <div className="px-4 py-3 border-b border-gray-100" style={{ borderLeftColor: c.dot, borderLeftWidth: 3 }}>
        <p className="font-semibold text-sm text-gray-800 truncate" title={host.name}>
          {host.name.split(".")[0]}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          {host.num_cpu_cores != null ? `${host.num_cpu_cores} ядер` : ""}
          {host.num_cpu_cores && host.memory_gb ? " · " : ""}
          {host.memory_gb != null ? `${host.memory_gb} ГБ RAM` : ""}
        </p>
      </div>

      {/* Usage bars */}
      <div className="px-4 pt-3 pb-2">
        <UsageBarLg label="CPU" pct={host.cpu_usage_pct} />
        <UsageBarLg label="RAM" pct={host.mem_usage_pct} />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>{host.vm_count} VMs</span>
          <span className="text-green-600">{host.powered_on} увімк.</span>
        </div>
      </div>

      {/* VM list */}
      {vms.length > 0 ? (
        <div className="px-3 pb-3 overflow-y-auto" style={{ maxHeight: 220 }}>
          {vms.map(vm => <VmChip key={vm.name} vm={vm} />)}
        </div>
      ) : q ? (
        <p className="px-4 pb-3 text-xs text-gray-400 italic">Не знайдено</p>
      ) : null}
    </div>
  );
}

function ClusterDetailModal({
  cluster,
  onClose,
}: {
  cluster: TopologyClusterItem;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const overlayRef = useRef<HTMLDivElement>(null);
  const sc = STATUS_COLORS[cluster.status as keyof typeof STATUS_COLORS] ?? STATUS_COLORS.unknown;

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Close on overlay click
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const totalVms    = cluster.vm_count;
  const poweredOn   = cluster.powered_on;
  const poweredOff  = totalVms - poweredOn;

  // Count VMs matching search across all hosts
  const matchCount = search
    ? cluster.hosts.reduce((n, h) =>
        n + h.vms.filter(v => v.name.toLowerCase().includes(search.toLowerCase())).length, 0)
    : totalVms;

  // Decide grid columns based on host count
  const hostCols = cluster.hosts.length <= 2 ? "grid-cols-1 sm:grid-cols-2"
    : cluster.hosts.length <= 4 ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
    : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
    >
      <div
        className="bg-gray-50 rounded-2xl shadow-2xl flex flex-col overflow-hidden w-full"
        style={{ maxWidth: 1280, maxHeight: "90vh" }}
      >
        {/* Modal header */}
        <div
          className="px-6 py-5 flex items-start justify-between shrink-0"
          style={{ background: sc.bg, borderBottom: `2px solid ${sc.border}` }}
        >
          <div className="flex items-center gap-4">
            <div className="w-4 h-4 rounded-full mt-0.5 shrink-0" style={{ backgroundColor: sc.dot }} />
            <div>
              <h2 className="text-xl font-bold text-gray-900">{cluster.name}</h2>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-1.5 text-sm text-gray-600">
                <span><strong className="text-gray-900">{cluster.host_count}</strong> хостів</span>
                <span><strong className="text-gray-900">{totalVms}</strong> VMs</span>
                <span className="text-green-700"><strong>{poweredOn}</strong> увімк.</span>
                <span className="text-gray-500"><strong>{poweredOff}</strong> вимк.</span>
                {cluster.host_cpu_pct != null && (
                  <span style={{ color: pctColor(cluster.host_cpu_pct) }}>
                    CPU avg <strong>{cluster.host_cpu_pct}%</strong>
                  </span>
                )}
                {cluster.host_ram_pct != null && (
                  <span style={{ color: pctColor(cluster.host_ram_pct) }}>
                    RAM avg <strong>{cluster.host_ram_pct}%</strong>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 ml-4">
            {/* Status badge */}
            <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${sc.badge}`}>
              {STATUS_LABELS[cluster.status] ?? cluster.status}
            </span>
            {/* Close */}
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-black/10 hover:bg-black/20 text-gray-700 text-lg leading-none transition"
              aria-label="Закрити"
            >
              ×
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="px-6 py-3 border-b border-gray-200 bg-white shrink-0 flex items-center gap-3">
          <input
            type="text"
            placeholder="Пошук VM по всіх хостах..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-400"
            autoFocus
          />
          <span className="text-xs text-gray-500 shrink-0">
            {search ? `Знайдено: ${matchCount}` : `${totalVms} VMs`}
          </span>
        </div>

        {/* Hosts grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {cluster.hosts.length === 0 ? (
            <p className="text-center text-gray-400 py-12">Немає даних про хости</p>
          ) : (
            <div className={`grid gap-4 ${hostCols}`}>
              {cluster.hosts.map(host => (
                <HostModalCard key={host.moid} host={host} search={search} />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 bg-white shrink-0 text-xs text-gray-400 flex justify-between">
          <span>Натисніть Esc або клікніть поза вікном щоб закрити</span>
          <span>{cluster.hosts.length} ESXi хостів · {totalVms} VM</span>
        </div>
      </div>
    </div>
  );
}

// ── VM side panel (host click on canvas) ─────────────────────────────────────

function VmListPanel({ host, onClose }: { host: TopologyHostItem; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [onlyOn, setOnlyOn] = useState(false);

  const vms = host.vms.filter(v => {
    if (onlyOn && v.power_state !== "poweredOn") return false;
    if (search && !v.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="w-80 bg-white border-l border-gray-200 flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div>
          <p className="font-semibold text-sm text-gray-800">{host.name.split(".")[0]}</p>
          <p className="text-xs text-gray-400">{host.vm_count} VMs · {host.powered_on} увімк.</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
      </div>
      <div className="px-3 py-2 border-b border-gray-100 flex gap-2">
        <input
          type="text"
          placeholder="Пошук VM..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:border-blue-400"
        />
        <button
          onClick={() => setOnlyOn(v => !v)}
          className={`px-2 py-1 rounded text-xs font-medium border transition ${
            onlyOn ? "bg-green-50 border-green-300 text-green-700" : "border-gray-300 text-gray-500"
          }`}
        >
          Увімк.
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {vms.length === 0 ? (
          <p className="text-center text-gray-400 text-xs py-6">Нічого не знайдено</p>
        ) : (
          vms.map(vm => <CanvasVmRow key={vm.name} vm={vm} />)
        )}
      </div>
      <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400">
        Показано {vms.length} з {host.vm_count}
      </div>
    </div>
  );
}

function CanvasVmRow({ vm }: { vm: TopologyVmItem }) {
  const on = vm.power_state === "poweredOn";
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 transition-colors">
      <div className={`w-2 h-2 rounded-full shrink-0 ${on ? "bg-green-400" : "bg-gray-300"}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-700 truncate">{vm.name}</p>
        {(vm.vcpu || vm.vram_gb) && (
          <p className="text-[10px] text-gray-400">
            {vm.vcpu ? `${vm.vcpu} vCPU` : ""}
            {vm.vcpu && vm.vram_gb ? " · " : ""}
            {vm.vram_gb ? `${vm.vram_gb} ГБ` : ""}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Canvas layout ─────────────────────────────────────────────────────────────

function buildLayout(
  clusters: TopologyClusterItem[],
  selectedHost: string | null,
) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const CLUSTER_PADDING = 24;

  const colWidths: number[] = new Array(COLS).fill(220);
  clusters.forEach((cluster, idx) => {
    const col = idx % COLS;
    const w = Math.max(220, cluster.hosts.length * (HOST_W + HOST_GAP) - HOST_GAP + 2 * CLUSTER_PADDING);
    if (w > colWidths[col]) colWidths[col] = w;
  });

  const colX: number[] = [];
  let xAcc = 0;
  for (let c = 0; c < COLS; c++) {
    colX[c] = xAcc;
    xAcc += colWidths[c] + GRID_COL_GAP;
  }

  const rowHeight = CLUSTER_H + COL_GAP + 120 + GRID_ROW_GAP;

  clusters.forEach((cluster, idx) => {
    const col          = idx % COLS;
    const row          = Math.floor(idx / COLS);
    const baseX        = colX[col];
    const baseY        = row * rowHeight;
    const clusterWidth = colWidths[col];

    nodes.push({
      id: `cl-${cluster.name}`,
      type: "cluster",
      position: { x: baseX + (clusterWidth - 208) / 2, y: baseY },
      data: { cluster },
    });

    const totalHostWidth = cluster.hosts.length * (HOST_W + HOST_GAP) - HOST_GAP;
    const hostStartX     = baseX + (clusterWidth - Math.max(totalHostWidth, 0)) / 2;

    cluster.hosts.forEach((host, i) => {
      const hostId = `host-${host.moid}`;
      nodes.push({
        id: hostId,
        type: "host",
        position: { x: hostStartX + i * (HOST_W + HOST_GAP), y: baseY + CLUSTER_H + COL_GAP },
        data: { host, isSelected: selectedHost === host.moid },
      });
      edges.push({
        id: `e-${cluster.name}-${host.moid}`,
        source: `cl-${cluster.name}`,
        target: hostId,
        type: "smoothstep",
        style: { stroke: "#d1d5db", strokeWidth: 1.5 },
        animated: false,
      });
    });
  });

  return { nodes, edges };
}

// ── Pagination controls ───────────────────────────────────────────────────────

function PageControls({
  page, totalPages, total, onPage,
}: {
  page: number; totalPages: number; total: number; onPage: (p: number) => void;
}) {
  const MAX_VISIBLE = 7;
  let pageNums: (number | "…")[] = Array.from({ length: totalPages }, (_, i) => i + 1);
  if (totalPages > MAX_VISIBLE) {
    const left  = Math.max(2, page - 2);
    const right = Math.min(totalPages - 1, page + 2);
    pageNums = [1];
    if (left > 2) pageNums.push("…");
    for (let p = left; p <= right; p++) pageNums.push(p);
    if (right < totalPages - 1) pageNums.push("…");
    pageNums.push(totalPages);
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-gray-500 mr-2">
        Кластери {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} з {total}
      </span>
      <button onClick={() => onPage(page - 1)} disabled={page === 1}
        className="px-2.5 py-1 rounded border border-gray-300 text-xs disabled:opacity-40 hover:bg-gray-50 transition">←</button>
      {pageNums.map((p, i) =>
        p === "…" ? (
          <span key={`ell-${i}`} className="px-1 text-gray-400 text-xs">…</span>
        ) : (
          <button key={p} onClick={() => onPage(p as number)}
            className={`px-2.5 py-1 rounded border text-xs transition ${
              p === page ? "bg-blue-600 text-white border-blue-600 font-semibold" : "border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}>{p}</button>
        ),
      )}
      <button onClick={() => onPage(page + 1)} disabled={page === totalPages}
        className="px-2.5 py-1 rounded border border-gray-300 text-xs disabled:opacity-40 hover:bg-gray-50 transition">→</button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TopologyMap() {
  const [modalCluster, setModalCluster]   = useState<TopologyClusterItem | null>(null);
  const [selectedHost, setSelectedHost]   = useState<TopologyHostItem | null>(null);
  const [clusterFilter, setClusterFilter] = useState("");
  const [page, setPage]                   = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ["topology"],
    queryFn:  api.topology,
    staleTime: 5 * 60 * 1000,
  });

  const handleFilterChange = (v: string) => {
    setClusterFilter(v);
    setPage(1);
    setSelectedHost(null);
  };

  const handlePage = (p: number) => {
    setPage(p);
    setSelectedHost(null);
  };

  const filteredClusters = useMemo(
    () => (data?.clusters ?? []).filter(c =>
      !clusterFilter || c.name.toLowerCase().includes(clusterFilter.toLowerCase())
    ),
    [data, clusterFilter],
  );

  const totalPages   = Math.max(1, Math.ceil(filteredClusters.length / PAGE_SIZE));
  const pageClusters = filteredClusters.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const { nodes, edges } = useMemo(
    () => buildLayout(pageClusters, selectedHost?.moid ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageClusters, selectedHost],
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === "cluster") {
        setModalCluster((node.data as ClusterNodeData).cluster);
      } else if (node.type === "host") {
        const host = (node.data as HostNodeData).host;
        setSelectedHost(prev => prev?.moid === host.moid ? null : host);
      }
    },
    [],
  );

  if (isLoading) return <div className="p-8 text-gray-400 animate-pulse">Завантаження топології...</div>;
  if (error)     return <div className="p-8 text-red-500 text-sm">Помилка: {String(error)}</div>;
  if (!data)     return null;

  return (
    <>
      {/* Cluster detail modal */}
      {modalCluster && (
        <ClusterDetailModal
          cluster={modalCluster}
          onClose={() => setModalCluster(null)}
        />
      )}

      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-white flex flex-wrap items-center gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Топологія кластерів</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {data.total_clusters} кластерів · {data.total_hosts} хостів · {data.total_vms} VMs
              ({data.total_powered_on} увімк.)
            </p>
          </div>

          <input
            type="text"
            placeholder="Фільтр кластерів..."
            value={clusterFilter}
            onChange={e => handleFilterChange(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-400 w-48"
          />

          <div className="flex items-center gap-3 text-xs text-gray-500">
            {(["ok", "warning", "critical", "unknown"] as const).map(s => (
              <span key={s} className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[s].dot }} />
                {STATUS_LABELS[s]}
              </span>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="ml-auto">
              <PageControls page={page} totalPages={totalPages} total={filteredClusters.length} onPage={handlePage} />
            </div>
          )}
        </div>

        {/* Canvas */}
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 relative">
            <ReactFlow
              key={`page-${page}-${clusterFilter}`}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodeClick={handleNodeClick}
              fitView
              fitViewOptions={{ padding: 0.12 }}
              minZoom={0.1}
              maxZoom={2}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
            >
              <Background color="#f1f5f9" gap={20} />
              <Controls showInteractive={false} />
              <MiniMap
                nodeColor={n => {
                  if (n.type === "cluster") {
                    const d = n.data as unknown as ClusterNodeData;
                    return STATUS_COLORS[d.cluster.status as keyof typeof STATUS_COLORS]?.dot ?? "#9ca3af";
                  }
                  return "#e5e7eb";
                }}
                style={{ background: "#f9fafb", border: "1px solid #e5e7eb" }}
              />
            </ReactFlow>
          </div>

          {selectedHost && (
            <VmListPanel host={selectedHost} onClose={() => setSelectedHost(null)} />
          )}
        </div>

        {totalPages > 1 && (
          <div className="px-6 py-3 border-t border-gray-200 bg-white flex justify-center">
            <PageControls page={page} totalPages={totalPages} total={filteredClusters.length} onPage={handlePage} />
          </div>
        )}
      </div>
    </>
  );
}
