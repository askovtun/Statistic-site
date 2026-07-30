import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type CapacityClusterItem } from "../api/client";

const PERIOD_OPTIONS = [
  { label: "7 днів", value: 7 },
  { label: "30 днів", value: 30 },
  { label: "90 днів", value: 90 },
];

const STATUS_CONFIG = {
  critical: { label: "Критично",  bg: "bg-red-100",    text: "text-red-700",    dot: "bg-red-500"    },
  warning:  { label: "Увага",     bg: "bg-amber-100",  text: "text-amber-700",  dot: "bg-amber-500"  },
  ok:       { label: "Норма",     bg: "bg-green-100",  text: "text-green-700",  dot: "bg-green-500"  },
  unknown:  { label: "Немає даних", bg: "bg-gray-100", text: "text-gray-500",   dot: "bg-gray-400"   },
};

function StatusBadge({ status }: { status: CapacityClusterItem["status"] }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function UsageBar({ pct, peak }: { pct: number | null; peak?: number | null }) {
  if (pct == null) return <span className="text-gray-300 text-xs">—</span>;
  const color = pct >= 80 ? "bg-red-500" : pct >= 65 ? "bg-amber-400" : "bg-blue-500";
  return (
    <div className="flex items-center gap-1.5 min-w-[90px]">
      <div className="relative flex-1 h-2 bg-gray-100 rounded-full overflow-visible">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
        {peak != null && (
          <div
            className="absolute top-0 w-0.5 h-2 bg-gray-700 rounded"
            style={{ left: `${Math.min(peak, 100)}%` }}
          />
        )}
      </div>
      <span className="text-xs text-gray-600 w-10 text-right">
        {pct.toFixed(0)}%{peak != null ? <span className="text-gray-400">/{peak.toFixed(0)}%</span> : null}
      </span>
    </div>
  );
}

function RatioChip({ ratio, label }: { ratio: number | null; label: string }) {
  if (ratio == null) return <span className="text-gray-300 text-xs">—</span>;
  const color = ratio > 4 ? "text-red-600 bg-red-50" : ratio > 2.5 ? "text-amber-700 bg-amber-50" : "text-green-700 bg-green-50";
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-mono font-semibold ${color}`}>
      {ratio.toFixed(1)}× {label}
    </span>
  );
}

function SummaryCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent ?? "text-gray-800"}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

type SortKey = "name" | "host_ram_pct" | "host_cpu_pct" | "free_ram_gb" | "free_cpu_cores" | "std_vms_can_fit" | "status";

export default function CapacityPlanning() {
  const [period, setPeriod] = useState(30);
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortAsc, setSortAsc] = useState(true);
  const [filter, setFilter] = useState<"all" | "critical" | "warning" | "ok">("all");
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["capacity", period],
    queryFn: () => api.capacity(period),
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((a) => !a);
    else { setSortKey(key); setSortAsc(true); }
  }

  const STATUS_ORDER: Record<string, number> = { critical: 0, warning: 1, ok: 2, unknown: 3 };

  const [showLarge, setShowLarge] = useState(true);

  const largeItems = (data?.items ?? []).filter((i) => i.host_count > 3);
  const smallItems = (data?.items ?? []).filter((i) => i.host_count <= 3);
  const activeGroup = showLarge ? largeItems : smallItems;

  const items = activeGroup
    .filter((i) => filter === "all" || i.status === filter)
    .filter((i) => !search || i.name.toLowerCase().includes(search.toLowerCase()))
    .slice()
    .sort((a, b) => {
      let diff = 0;
      if (sortKey === "status")           diff = (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3);
      else if (sortKey === "name")        diff = a.name.localeCompare(b.name);
      else if (sortKey === "host_cpu_pct") diff = (a.host_cpu_pct ?? -1) - (b.host_cpu_pct ?? -1);
      else if (sortKey === "host_ram_pct") diff = (a.host_ram_pct ?? -1) - (b.host_ram_pct ?? -1);
      else if (sortKey === "free_ram_gb")   diff = (a.free_ram_gb ?? -1) - (b.free_ram_gb ?? -1);
      else if (sortKey === "free_cpu_cores") diff = (a.free_cpu_cores ?? -1) - (b.free_cpu_cores ?? -1);
      else if (sortKey === "std_vms_can_fit") diff = (a.std_vms_can_fit ?? -1) - (b.std_vms_can_fit ?? -1);
      return sortAsc ? diff : -diff;
    });

  function Th({ label, k }: { label: string; k: SortKey }) {
    const active = sortKey === k;
    return (
      <th
        className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide cursor-pointer select-none whitespace-nowrap hover:text-gray-700"
        onClick={() => toggleSort(k)}
      >
        {label}{active ? (sortAsc ? " ↑" : " ↓") : ""}
      </th>
    );
  }

  if (isLoading) return <div className="p-8 text-gray-400">Завантаження...</div>;
  if (error) return <div className="p-8 text-red-500">Помилка: {String(error)}</div>;
  if (!data) return null;

  const totalFreeRam = items.reduce((s, i) => s + (i.free_ram_gb ?? 0), 0);
  const totalFreeCores = items.reduce((s, i) => s + (i.free_cpu_cores ?? 0), 0);

  // Per-group summary totals (activeGroup, before status filter)
  const groupCritical    = activeGroup.filter((i) => i.status === "critical").length;
  const groupWarning     = activeGroup.filter((i) => i.status === "warning").length;
  const groupCores       = activeGroup.reduce((s, i) => s + (i.physical_cpu_cores ?? 0), 0);
  const groupRamGb       = activeGroup.reduce((s, i) => s + (i.physical_ram_gb ?? 0), 0);
  const groupStorageGb   = activeGroup.reduce((s, i) => s + (i.total_storage_gb ?? 0), 0);
  const groupCanFit      = activeGroup.reduce((s, i) => s + (i.std_vms_can_fit ?? 0), 0);

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Планування потужностей</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {data.total_clusters} кластерів · ресурси від ESXi quickStats + vCenter метрики
          </p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {PERIOD_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setPeriod(o.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                period === o.value ? "bg-white shadow-sm text-blue-700" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards — reflect active group */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <SummaryCard label="Кластерів" value={activeGroup.length} sub={`з ${data.total_clusters} всього`} />
        <SummaryCard
          label="Критично"
          value={groupCritical}
          sub="RAM або CPU > 80%"
          accent={groupCritical > 0 ? "text-red-600" : "text-gray-800"}
        />
        <SummaryCard
          label="Увага"
          value={groupWarning}
          sub="65–80%"
          accent={groupWarning > 0 ? "text-amber-600" : "text-gray-800"}
        />
        <SummaryCard label="Ядер (група)" value={groupCores} sub="фізичні" />
        <SummaryCard label="RAM (група)" value={`${Math.round(groupRamGb / 1024)} ТБ`} sub={`${groupRamGb} ГБ`} />
        <SummaryCard
          label="Сховище (група)"
          value={groupStorageGb > 0 ? `${Math.round(groupStorageGb / 1024)} ТБ` : "—"}
          sub={groupStorageGb > 0 ? `${groupStorageGb} ГБ` : "немає даних"}
        />
        <SummaryCard label="Можна розмістити" value={groupCanFit} sub="ВМ (4 vCPU / 8 GB)" accent="text-blue-700" />
      </div>

      {/* Note */}
      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-2.5 text-sm text-blue-700">
        «Вільно ядер» / «Вільно RAM» — фактично вільні ресурси (як у vCenter). «ВМ влізе» враховує поріг <strong>80%</strong> — рекомендований запас безпеки.
        Стандартна ВМ: <strong>4 vCPU / 8 ГБ RAM</strong>.
        Навантаження CPU/RAM — з ESXi quickStats (поточне), а також середнє/пік за {period} днів (де є vCenter метрики).
      </div>

      {/* Group toggle */}
      <div className="flex gap-2 p-1 bg-gray-100 rounded-lg w-fit">
        <button
          onClick={() => { setShowLarge(true); setFilter("all"); }}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            showLarge ? "bg-white shadow-sm text-blue-700" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Великі кластери ({largeItems.length})
          <span className="ml-1 text-xs text-gray-400">4+ хости</span>
        </button>
        <button
          onClick={() => { setShowLarge(false); setFilter("all"); }}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            !showLarge ? "bg-white shadow-sm text-blue-700" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Малі кластери ({smallItems.length})
          <span className="ml-1 text-xs text-gray-400">2–3 хости</span>
        </button>
      </div>

      {/* Search + Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <input
          type="text"
          placeholder="Пошук кластеру..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-52 focus:outline-none focus:border-blue-400"
        />
        {(["all", "critical", "warning", "ok"] as const).map((f) => {
          const labels: Record<string, string> = { all: "Всі", critical: "Критичні", warning: "Увага", ok: "Норма" };
          const counts: Record<string, number> = {
            all: activeGroup.length,
            critical: activeGroup.filter((i) => i.status === "critical").length,
            warning: activeGroup.filter((i) => i.status === "warning").length,
            ok: activeGroup.filter((i) => i.status === "ok").length,
          };
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                filter === f
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
              }`}
            >
              {labels[f]} ({counts[f]})
            </button>
          );
        })}
        <span className="ml-auto text-xs text-gray-400 self-center">
          Вільно: {totalFreeCores} ядер · {totalFreeRam} ГБ RAM
        </span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <Th label="Кластер" k="name" />
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Хости / Ядра / RAM</th>
                <Th label="CPU%" k="host_cpu_pct" />
                <Th label="RAM%" k="host_ram_pct" />
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">vCPU× / vRAM×</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">ВМ (увімк.)</th>
                <Th label="Вільно ядер" k="free_cpu_cores" />
                <Th label="Вільно RAM" k="free_ram_gb" />
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Сховище%</th>
                <Th label="ВМ влізе" k="std_vms_can_fit" />
                <Th label="Статус" k="status" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((item) => (
                <ClusterRow key={item.name} item={item} period={period} />
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-6 py-10 text-center text-gray-400">
                    Немає кластерів за вибраним фільтром
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ClusterRow({ item, period }: { item: CapacityClusterItem; period: number }) {
  const [expanded, setExpanded] = useState(false);

  // Main bar shows host-level quickStats (authoritative host utilization).
  // avg_cpu_pct is VM-level metric from vCenter — shown only in the expanded detail.
  const cpuPct = item.host_cpu_pct;
  const ramPct = item.host_ram_pct;

  return (
    <>
      <tr
        className="hover:bg-gray-50 cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Cluster name */}
        <td className="px-3 py-3 font-medium text-gray-800 whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            <span className="text-gray-300 text-xs">{expanded ? "▼" : "▶"}</span>
            {item.name}
          </div>
        </td>

        {/* Physical resources */}
        <td className="px-3 py-3 text-gray-600 whitespace-nowrap text-xs">
          {item.host_count}h · {item.physical_cpu_cores ?? "?"}c · {item.physical_ram_gb ?? "?"}GB
        </td>

        {/* CPU% bar */}
        <td className="px-3 py-3">
          <UsageBar pct={cpuPct} peak={item.peak_cpu_pct} />
        </td>

        {/* RAM% bar */}
        <td className="px-3 py-3">
          <UsageBar pct={ramPct} peak={item.peak_ram_pct} />
        </td>

        {/* Over-commit ratios */}
        <td className="px-3 py-3">
          <div className="flex flex-col gap-0.5">
            <RatioChip ratio={item.vcpu_ratio} label="vCPU" />
            <RatioChip ratio={item.vram_ratio} label="vRAM" />
          </div>
        </td>

        {/* VM counts */}
        <td className="px-3 py-3 text-gray-700 text-xs whitespace-nowrap">
          {item.total_vms} <span className="text-gray-400">({item.powered_on_vms} увімк.)</span>
        </td>

        {/* Free CPU cores */}
        <td className="px-3 py-3 font-medium whitespace-nowrap">
          {item.free_cpu_cores != null ? (
            <span className={item.free_cpu_cores === 0 ? "text-red-600" : "text-gray-700"}>
              {item.free_cpu_cores}
            </span>
          ) : "—"}
        </td>

        {/* Free RAM */}
        <td className="px-3 py-3 font-medium whitespace-nowrap">
          {item.free_ram_gb != null ? (
            <span className={item.free_ram_gb === 0 ? "text-red-600" : "text-gray-700"}>
              {item.free_ram_gb} ГБ
            </span>
          ) : "—"}
        </td>

        {/* Storage */}
        <td className="px-3 py-3">
          {item.storage_used_pct != null ? (
            <div className="flex flex-col gap-0.5">
              <UsageBar pct={item.storage_used_pct} />
              <span className="text-xs text-gray-400">
                {item.free_storage_gb != null ? `${Math.round(item.free_storage_gb / 1024)} ТБ вільно` : ""}
              </span>
            </div>
          ) : <span className="text-gray-300 text-xs">—</span>}
        </td>

        {/* Std VMs can fit */}
        <td className="px-3 py-3 font-semibold whitespace-nowrap">
          {item.std_vms_can_fit != null ? (
            <span className={item.std_vms_can_fit === 0 ? "text-red-600" : "text-blue-700"}>
              {item.std_vms_can_fit}
            </span>
          ) : "—"}
        </td>

        {/* Status */}
        <td className="px-3 py-3">
          <StatusBadge status={item.status} />
        </td>
      </tr>

      {/* Expanded detail row */}
      {expanded && (
        <tr className="bg-blue-50/40">
          <td colSpan={11} className="px-6 py-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-500 mb-1">Фізичні ресурси (ESXi)</p>
                <p className="font-medium text-gray-700">{item.host_count} хостів</p>
                <p className="text-gray-600">{item.physical_cpu_cores} фіз. ядер</p>
                <p className="text-gray-600">{item.physical_ram_gb} ГБ RAM</p>
                <p className="text-xs text-gray-400 mt-1">
                  Поточне: CPU {item.host_cpu_pct ?? "?"}% · RAM {item.host_ram_pct ?? "?"}%
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Виділено (CMDB)</p>
                <p className="font-medium text-gray-700">{item.total_vms} ВМ ({item.powered_on_vms} увімк.)</p>
                <p className="text-gray-600">{item.allocated_vcpu} vCPU</p>
                <p className="text-gray-600">{item.allocated_vram_gb} ГБ vRAM</p>
                <p className="text-xs text-gray-400 mt-1">
                  Перевиділення: {item.vcpu_ratio ?? "?"}× vCPU · {item.vram_ratio ?? "?"}× vRAM
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">VM навантаження vCenter ({period ?? 30}д)</p>
                {item.avg_cpu_pct != null ? (
                  <>
                    <p className="text-gray-600">CPU VM сер. <strong>{item.avg_cpu_pct}%</strong> · пік {item.peak_cpu_pct ?? "?"}%</p>
                    <p className="text-gray-600">RAM VM сер. <strong>{item.avg_ram_pct}%</strong> · пік {item.peak_ram_pct ?? "?"}%</p>
                    <p className="text-xs text-gray-400 mt-1">% відносно vCPU кожної ВМ (тренд)</p>
                  </>
                ) : (
                  <p className="text-gray-400 text-xs">Немає даних vCenter (обмежений доступ)</p>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Залишок (фактично вільно)</p>
                <p className="font-medium text-gray-700">{item.free_cpu_cores ?? "?"} вільних ядер</p>
                <p className="text-gray-600">{item.free_ram_gb ?? "?"} ГБ вільного RAM</p>
                <p className={`font-semibold mt-1 ${(item.std_vms_can_fit ?? 0) === 0 ? "text-red-600" : "text-blue-700"}`}>
                  → {item.std_vms_can_fit ?? "?"} стандартних ВМ (з порогом 80%)
                </p>
                <p className="text-xs text-gray-400">4 vCPU / 8 ГБ RAM кожна</p>
                {item.total_storage_gb != null && (
                  <div className="mt-2 pt-2 border-t border-blue-100">
                    <p className="text-xs text-gray-500 mb-0.5">Сховище (datastore)</p>
                    <p className="text-gray-600">
                      {Math.round((item.total_storage_gb - (item.free_storage_gb ?? 0)) / 1024)} ТБ зайнято
                      {" / "}{Math.round(item.total_storage_gb / 1024)} ТБ всього
                    </p>
                    <p className="text-gray-600">{item.free_storage_gb ?? "?"} ГБ вільно · {item.storage_used_pct}% зайнято</p>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
