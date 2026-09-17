import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { DiskAnomalyItem, DiskReclamationItem } from "../api/client";
import { exportToXlsx } from "../utils/exportXlsx";
import DiskDetailModal from "../components/DiskDetailModal";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "reclamation" | "anomalies";
type SortDir = "asc" | "desc";

type ReclaimSortKey = "name" | "cluster" | "avg_free_pct" | "min_free_pct" | "variance_pct" | "data_points";
type AnomalySortKey = "name" | "cluster" | "current_free_pct" | "drop_pct" | "acceleration" | "data_points";

interface SortState<K> { key: K; dir: SortDir }

const PERIODS = [7, 14, 30, 60, 90] as const;

// ── Small helpers ─────────────────────────────────────────────────────────────

function pct(v: number | null | undefined, decimals = 1): string {
  return v == null ? "—" : `${v.toFixed(decimals)}%`;
}

function freePctBadge(v: number | null | undefined) {
  if (v == null) return <span className="text-gray-400">—</span>;
  const cls =
    v < 10 ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" :
    v < 20 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" :
    v < 40 ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" :
             "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
  return <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${cls}`}>{v.toFixed(1)}%</span>;
}

function dropBadge(v: number | null | undefined) {
  if (v == null) return <span className="text-gray-400">—</span>;
  const cls =
    v >= 20 ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" :
    v >= 10 ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" :
              "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300";
  return <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${cls}`}>▼ {v.toFixed(1)}%</span>;
}

function accelBadge(v: number | null | undefined) {
  if (v == null) return <span className="text-gray-400">—</span>;
  const cls =
    v >= 3 ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" :
    v >= 1.5 ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" :
               "text-gray-500 dark:text-slate-400";
  return <span className={`text-xs font-semibold ${cls}`}>{v.toFixed(1)}×</span>;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, color,
}: {
  label: string; value: number | string; sub?: string; color: string;
}) {
  return (
    <div className={`flex flex-col gap-1 rounded-xl border-l-4 ${color} bg-white dark:bg-slate-900 px-4 py-3 shadow-sm`}>
      <p className="text-xs text-gray-500 dark:text-slate-400 font-medium leading-tight">{label}</p>
      <p className="text-2xl font-bold font-mono tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-gray-400 dark:text-slate-500">{sub}</p>}
    </div>
  );
}

function Th<K extends string>({
  col, label, sort, onSort,
}: {
  col: K; label: string; sort: SortState<K>; onSort: (k: K) => void;
}) {
  const active = sort.key === col;
  return (
    <th
      onClick={() => onSort(col)}
      className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide cursor-pointer hover:text-gray-800 dark:hover:text-slate-100 select-none whitespace-nowrap"
    >
      {label}
      <span className="ml-1 opacity-50">{active ? (sort.dir === "asc" ? "↑" : "↓") : "⇅"}</span>
    </th>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-8 text-center text-gray-400 dark:text-slate-500 text-sm">
        Немає даних за поточними фільтрами
      </td>
    </tr>
  );
}

// ── Reclamation table ─────────────────────────────────────────────────────────

function ReclamationTable({
  items, sort, onSort, period, onRowClick,
}: {
  items: DiskReclamationItem[];
  sort: SortState<ReclaimSortKey>;
  onSort: (k: ReclaimSortKey) => void;
  period: number;
  onRowClick: (name: string) => void;
}) {
  function handleExport() {
    exportToXlsx(
      `disk-reclamation-${period}d.xlsx`,
      "Рекламація",
      items.map((r) => ({
        "Назва": r.name,
        "Кластер": r.cluster ?? "",
        "FQDN": r.fqdn ?? "",
        "IP": r.primary_ip ?? "",
        "Серед. вільно %": r.avg_free_pct,
        "Мін. вільно %": r.min_free_pct,
        "Варіація σ %": r.variance_pct,
        "Точок даних": r.data_points,
      })),
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-slate-800">
        <div>
          <span className="font-semibold text-sm">
            Рекламація — {items.length} ВМ
          </span>
          <span className="ml-2 text-xs text-gray-400 dark:text-slate-500">
            стабільний диск з надлишком вільного місця
          </span>
        </div>
        <button
          onClick={handleExport}
          disabled={items.length === 0}
          className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 transition disabled:opacity-40"
        >
          Експорт XLSX
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-800/60">
            <tr>
              <Th col="name"         label="Назва"          sort={sort} onSort={onSort} />
              <Th col="cluster"      label="Кластер"        sort={sort} onSort={onSort} />
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap">IP</th>
              <Th col="avg_free_pct"  label="Серед. вільно"  sort={sort} onSort={onSort} />
              <Th col="min_free_pct"  label="Мін. вільно"   sort={sort} onSort={onSort} />
              <Th col="variance_pct"  label="Варіація σ"     sort={sort} onSort={onSort} />
              <Th col="data_points"   label="Точок"          sort={sort} onSort={onSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {items.length === 0 ? <EmptyRow cols={7} /> : items.map((r) => (
              <tr key={r.name} onClick={() => onRowClick(r.name)} className="hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-pointer transition-colors">
                <td className="px-3 py-2 font-medium text-blue-700 dark:text-blue-400 hover:underline">{r.name}</td>
                <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{r.cluster ?? "—"}</td>
                <td className="px-3 py-2 text-gray-400 dark:text-slate-500 font-mono text-xs">{r.primary_ip ?? "—"}</td>
                <td className="px-3 py-2">{freePctBadge(r.avg_free_pct)}</td>
                <td className="px-3 py-2 text-gray-600 dark:text-slate-300 tabular-nums">{pct(r.min_free_pct)}</td>
                <td className="px-3 py-2 text-gray-500 dark:text-slate-400 tabular-nums">{r.variance_pct.toFixed(2)}%</td>
                <td className="px-3 py-2 text-gray-400 dark:text-slate-500 tabular-nums">{r.data_points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Anomaly table ─────────────────────────────────────────────────────────────

function AnomalyTable({
  items, sort, onSort, period, onRowClick,
}: {
  items: DiskAnomalyItem[];
  sort: SortState<AnomalySortKey>;
  onSort: (k: AnomalySortKey) => void;
  period: number;
  onRowClick: (name: string) => void;
}) {
  function handleExport() {
    exportToXlsx(
      `disk-anomalies-${period}d.xlsx`,
      "Аномалії",
      items.map((a) => ({
        "Назва": a.name,
        "Кластер": a.cluster ?? "",
        "FQDN": a.fqdn ?? "",
        "IP": a.primary_ip ?? "",
        "Поточне вільно %": a.current_free_pct ?? "",
        "Початкове вільно %": a.start_free_pct ?? "",
        "Падіння %": a.drop_pct ?? "",
        "Нед. тренд %/д": a.recent_slope ?? "",
        "Іст. тренд %/д": a.hist_slope ?? "",
        "Прискорення ×": a.acceleration ?? "",
        "Точок даних": a.data_points,
      })),
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-slate-800">
        <div>
          <span className="font-semibold text-sm">
            Аномалії — {items.length} ВМ
          </span>
          <span className="ml-2 text-xs text-gray-400 dark:text-slate-500">
            значне скорочення вільного місця за вибраний період
          </span>
        </div>
        <button
          onClick={handleExport}
          disabled={items.length === 0}
          className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 transition disabled:opacity-40"
        >
          Експорт XLSX
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-800/60">
            <tr>
              <Th col="name"            label="Назва"           sort={sort} onSort={onSort} />
              <Th col="cluster"         label="Кластер"         sort={sort} onSort={onSort} />
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap">IP</th>
              <Th col="current_free_pct" label="Поточне вільно" sort={sort} onSort={onSort} />
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap">Початкове</th>
              <Th col="drop_pct"        label="Падіння"         sort={sort} onSort={onSort} />
              <Th col="acceleration"    label="Прискорення"     sort={sort} onSort={onSort} />
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap">Нед. тренд</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap">Іст. тренд</th>
              <Th col="data_points"     label="Точок"           sort={sort} onSort={onSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {items.length === 0 ? <EmptyRow cols={10} /> : items.map((a) => (
              <tr key={a.name} onClick={() => onRowClick(a.name)} className="hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-pointer transition-colors">
                <td className="px-3 py-2 font-medium text-blue-700 dark:text-blue-400 hover:underline">{a.name}</td>
                <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{a.cluster ?? "—"}</td>
                <td className="px-3 py-2 text-gray-400 dark:text-slate-500 font-mono text-xs">{a.primary_ip ?? "—"}</td>
                <td className="px-3 py-2">{freePctBadge(a.current_free_pct)}</td>
                <td className="px-3 py-2 text-gray-500 dark:text-slate-400 tabular-nums">{pct(a.start_free_pct)}</td>
                <td className="px-3 py-2">{dropBadge(a.drop_pct)}</td>
                <td className="px-3 py-2">{accelBadge(a.acceleration)}</td>
                <td className="px-3 py-2 text-gray-500 dark:text-slate-400 tabular-nums text-xs">
                  {a.recent_slope != null ? `${a.recent_slope.toFixed(3)}%/д` : "—"}
                </td>
                <td className="px-3 py-2 text-gray-500 dark:text-slate-400 tabular-nums text-xs">
                  {a.hist_slope != null ? `${a.hist_slope.toFixed(3)}%/д` : "—"}
                </td>
                <td className="px-3 py-2 text-gray-400 dark:text-slate-500 tabular-nums">{a.data_points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DiskAnalyticsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // URL-backed state (tab, period, cluster, search)
  const tab = ((searchParams.get("tab") as Tab) === "anomalies" ? "anomalies" : "reclamation") as Tab;
  const period = PERIODS.includes(Number(searchParams.get("days")) as typeof PERIODS[number])
    ? Number(searchParams.get("days")) as number : 30;
  const clusterFilter = searchParams.get("cluster") ?? "";
  const searchQ = searchParams.get("q") ?? "";

  // Modal state
  const [selectedVm, setSelectedVm] = useState<string | null>(null);

  // Local slider state (not URL — too noisy for history)
  const [minFree, setMinFree] = useState(30);
  const [maxVar, setMaxVar] = useState(3);
  const [minDrop, setMinDrop] = useState(5);

  // Sort state per tab
  const [rSort, setRSort] = useState<SortState<ReclaimSortKey>>({ key: "avg_free_pct", dir: "desc" });
  const [aSort, setASort] = useState<SortState<AnomalySortKey>>({ key: "drop_pct", dir: "desc" });

  function setParam(k: string, v: string) {
    setSearchParams(
      (prev) => { const n = new URLSearchParams(prev); n.set(k, v); return n; },
      { replace: true },
    );
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ["disk-analytics", period],
    queryFn: () => api.diskAnalytics(period),
    staleTime: 5 * 60_000,
  });

  // Unique clusters from both lists
  const clusters = useMemo(() => {
    const s = new Set<string>();
    data?.reclamation.forEach((r) => r.cluster && s.add(r.cluster));
    data?.anomalies.forEach((a) => a.cluster && s.add(a.cluster));
    return [...s].sort();
  }, [data]);

  // Filtered + sorted reclamation
  const filteredReclaim = useMemo<DiskReclamationItem[]>(() => {
    if (!data) return [];
    const items = data.reclamation.filter(
      (r) =>
        r.avg_free_pct >= minFree &&
        r.variance_pct <= maxVar &&
        (clusterFilter === "" || r.cluster === clusterFilter) &&
        (searchQ === "" || r.name.toLowerCase().includes(searchQ.toLowerCase()) ||
          (r.fqdn ?? "").toLowerCase().includes(searchQ.toLowerCase())),
    );
    return [...items].sort((a, b) => {
      const av = a[rSort.key] ?? "";
      const bv = b[rSort.key] ?? "";
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return rSort.dir === "asc" ? cmp : -cmp;
    });
  }, [data, minFree, maxVar, clusterFilter, searchQ, rSort]);

  // Filtered + sorted anomalies
  const filteredAnomalies = useMemo<DiskAnomalyItem[]>(() => {
    if (!data) return [];
    const items = data.anomalies.filter(
      (a) =>
        (a.drop_pct ?? 0) >= minDrop &&
        (clusterFilter === "" || a.cluster === clusterFilter) &&
        (searchQ === "" || a.name.toLowerCase().includes(searchQ.toLowerCase()) ||
          (a.fqdn ?? "").toLowerCase().includes(searchQ.toLowerCase())),
    );
    return [...items].sort((a, b) => {
      const av = a[aSort.key] ?? "";
      const bv = b[aSort.key] ?? "";
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return aSort.dir === "asc" ? cmp : -cmp;
    });
  }, [data, minDrop, clusterFilter, searchQ, aSort]);

  function toggleRSort(key: ReclaimSortKey) {
    setRSort((p) => ({ key, dir: p.key === key && p.dir === "desc" ? "asc" : "desc" }));
  }
  function toggleASort(key: AnomalySortKey) {
    setASort((p) => ({ key, dir: p.key === key && p.dir === "desc" ? "asc" : "desc" }));
  }

  if (isLoading) {
    return (
      <div className="p-8 text-gray-500 dark:text-slate-400 text-sm">
        Завантаження дискової аналітики...
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="p-8 text-red-500 text-sm">
        Помилка завантаження даних. Перевірте backend.
      </div>
    );
  }

  const fleet = data.fleet;

  return (
    <div className="p-6 space-y-5 max-w-screen-2xl">

      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold">Дискова аналітика</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
          Рекламація та аномалії дискової підсистеми ВМ
          {data.synced_at && (
            <span className="ml-1">
              · станом на {new Date(data.synced_at).toLocaleString("uk-UA")}
            </span>
          )}
        </p>
      </div>

      {/* ── Fleet summary cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <StatCard
          label="ВМ з даними"
          value={fleet.total_vms_with_data}
          sub={`за ${period} днів`}
          color="border-gray-400"
        />
        <StatCard
          label="Критичні"
          value={fleet.critical_count}
          sub="< 10% вільно"
          color="border-red-500"
        />
        <StatCard
          label="Попередження"
          value={fleet.warning_count}
          sub="10–20% вільно"
          color="border-amber-500"
        />
        <StatCard
          label="Рекламація"
          value={filteredReclaim.length}
          sub={`≥ ${minFree}% вільно, σ ≤ ${maxVar}%`}
          color="border-green-500"
        />
        <StatCard
          label="Аномалії"
          value={filteredAnomalies.length}
          sub={`падіння ≥ ${minDrop}%`}
          color="border-orange-500"
        />
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-slate-700">
        {(["reclamation", "anomalies"] as Tab[]).map((t) => {
          const label = t === "reclamation"
            ? `Рекламація (${filteredReclaim.length})`
            : `Аномалії (${filteredAnomalies.length})`;
          return (
            <button
              key={t}
              onClick={() => setParam("tab", t)}
              className={
                "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors " +
                (tab === t
                  ? "border-blue-500 text-blue-700 dark:text-blue-400"
                  : "border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:border-gray-300 dark:hover:border-slate-600")
              }
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* ── Filter bar ────────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 px-4 py-3 space-y-3">

        {/* Common filters row */}
        <div className="flex flex-wrap items-center gap-3">

          {/* Period */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap">Період:</span>
            <div className="flex rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden text-xs">
              {PERIODS.map((d) => (
                <button
                  key={d}
                  onClick={() => setParam("days", String(d))}
                  className={
                    "px-2.5 py-1.5 font-medium transition-colors " +
                    (period === d
                      ? "bg-blue-500 text-white"
                      : "text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800")
                  }
                >
                  {d}д
                </button>
              ))}
            </div>
          </div>

          {/* Cluster */}
          <select
            value={clusterFilter}
            onChange={(e) => setParam("cluster", e.target.value)}
            className="text-sm border border-gray-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="">Всі кластери</option>
            {clusters.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          {/* Search */}
          <input
            type="search"
            placeholder="Пошук за назвою / FQDN..."
            value={searchQ}
            onChange={(e) => setParam("q", e.target.value)}
            className="text-sm border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 w-52 focus:outline-none focus:ring-1 focus:ring-blue-400 placeholder-gray-400"
          />
        </div>

        {/* Tab-specific threshold sliders */}
        {tab === "reclamation" && (
          <div className="flex flex-wrap gap-6 pt-1">
            <label className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-slate-300">
              <span className="whitespace-nowrap">Мін. вільно:</span>
              <input
                type="range" min={10} max={80} step={5}
                value={minFree}
                onChange={(e) => setMinFree(Number(e.target.value))}
                className="w-28 accent-green-500"
              />
              <span className="font-semibold text-green-600 dark:text-green-400 w-10 tabular-nums">{minFree}%</span>
            </label>
            <label className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-slate-300">
              <span className="whitespace-nowrap">Макс. варіація (σ):</span>
              <input
                type="range" min={0.5} max={10} step={0.5}
                value={maxVar}
                onChange={(e) => setMaxVar(Number(e.target.value))}
                className="w-28 accent-blue-500"
              />
              <span className="font-semibold text-blue-600 dark:text-blue-400 w-10 tabular-nums">{maxVar}%</span>
            </label>
            <p className="text-xs text-gray-400 dark:text-slate-500 self-center">
              Показуємо ВМ де диск стабільний (σ менше порогу) та є надлишок місця
            </p>
          </div>
        )}

        {tab === "anomalies" && (
          <div className="flex flex-wrap gap-6 pt-1">
            <label className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-slate-300">
              <span className="whitespace-nowrap">Мін. падіння:</span>
              <input
                type="range" min={1} max={30} step={1}
                value={minDrop}
                onChange={(e) => setMinDrop(Number(e.target.value))}
                className="w-28 accent-orange-500"
              />
              <span className="font-semibold text-orange-600 dark:text-orange-400 w-10 tabular-nums">{minDrop}%</span>
            </label>
            <p className="text-xs text-gray-400 dark:text-slate-500 self-center">
              Показуємо ВМ де вільне місце скоротилось більше ніж на поріг за обраний період
            </p>
          </div>
        )}
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────────── */}
      {tab === "reclamation" ? (
        <ReclamationTable
          items={filteredReclaim}
          sort={rSort}
          onSort={toggleRSort}
          period={period}
          onRowClick={setSelectedVm}
        />
      ) : (
        <AnomalyTable
          items={filteredAnomalies}
          sort={aSort}
          onSort={toggleASort}
          period={period}
          onRowClick={setSelectedVm}
        />
      )}

      {selectedVm && (
        <DiskDetailModal vmName={selectedVm} onClose={() => setSelectedVm(null)} />
      )}
    </div>
  );
}
