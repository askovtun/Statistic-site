import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type ResourceItem } from "../api/client";
import StatusBadge from "../components/StatusBadge";
import ResourceBar from "../components/ResourceBar";
import Pagination from "../components/Pagination";
import ColumnFilterDropdown from "../components/ColumnFilterDropdown";
import NumberRangeFilterDropdown, { type NumberRange } from "../components/NumberRangeFilterDropdown";
import ColumnVisibilityDropdown, { type ColumnDef } from "../components/ColumnVisibilityDropdown";
import ResourceHistoryModal from "../components/ResourceHistoryModal";
import { exportToXlsx } from "../utils/exportXlsx";

const PAGE_SIZE = 50;

const statusVariant = (s: ResourceItem["resource_status"]) => {
  switch (s) {
    case "optimal": return "success";
    case "oversized": return "info";
    case "undersized": return "danger";
    default: return "neutral";
  }
};

const statusLabel: Record<ResourceItem["resource_status"], string> = {
  optimal: "Оптимально",
  oversized: "Oversized",
  undersized: "Undersized",
  no_data: "Немає даних",
};

function TrendBadge({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="text-gray-300 text-xs">—</span>;
  const abs = Math.abs(delta);
  if (abs < 2) return <span className="text-xs text-gray-400 ml-1">→</span>;
  if (delta > 0)
    return <span className="text-xs text-red-500 font-medium ml-1" title={`+${delta.toFixed(1)}% порівняно з попереднім періодом`}>↑{delta.toFixed(1)}%</span>;
  return <span className="text-xs text-green-500 font-medium ml-1" title={`${delta.toFixed(1)}% порівняно з попереднім періодом`}>↓{abs.toFixed(1)}%</span>;
}

function AvailBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-gray-300 text-xs">—</span>;
  const color = pct >= 99 ? "text-green-600" : pct >= 95 ? "text-amber-600" : "text-red-600";
  return <span className={`text-xs font-semibold ${color}`} title="Відсоток часу з наявними даними Zabbix">{pct.toFixed(1)}%</span>;
}

type ColumnKey = "name" | "cluster" | "os_family" | "vcpu" | "vram_gb" | "resource_status";

const columnValue: Record<ColumnKey, (i: ResourceItem) => string> = {
  name: (i) => i.name,
  cluster: (i) => i.cluster ?? "—",
  os_family: (i) => i.os_family ?? "—",
  vcpu: (i) => (i.vcpu != null ? String(i.vcpu) : "—"),
  vram_gb: (i) => (i.vram_gb != null ? `${i.vram_gb} GB` : "—"),
  resource_status: (i) => statusLabel[i.resource_status],
};

type NumericColumnKey =
  | "max_cpu_pct"
  | "max_ram_pct"
  | "vc_max_cpu_pct"
  | "vc_max_ram_pct"
  | "zbx_disk_used_pct"
  | "max_disk_used_pct"
  | "max_disk_io_kbps"
  | "availability_pct";

const VISIBLE_COLUMNS: ColumnDef[] = [
  { key: "cluster",         label: "Кластер" },
  { key: "os_family",       label: "OS" },
  { key: "vcpu",            label: "vCPU" },
  { key: "vram_gb",         label: "vRAM" },
  { key: "cpu_pik",         label: "CPU % (пік)" },
  { key: "ram_pik",         label: "RAM % (пік)" },
  { key: "disk_zbx",        label: "Диск % (Zabbix)" },
  { key: "cpu_vc",          label: "CPU % (vCenter)" },
  { key: "ram_vc",          label: "RAM % (vCenter)" },
  { key: "disk_pct",        label: "Диск % (vCenter)" },
  { key: "disk_io",         label: "Disk I/O" },
  { key: "availability",    label: "Доступність" },
  { key: "rightsizing",     label: "Right-sizing" },
  { key: "status",          label: "Статус" },
  { key: "recommendations", label: "Рекомендації" },
];
type ColKey = typeof VISIBLE_COLUMNS[number]["key"];

const numericColumnValue: Record<NumericColumnKey, (i: ResourceItem) => number | null> = {
  max_cpu_pct: (i) => i.max_cpu_pct,
  max_ram_pct: (i) => i.max_ram_pct,
  vc_max_cpu_pct: (i) => i.vc_max_cpu_pct,
  vc_max_ram_pct: (i) => i.vc_max_ram_pct,
  zbx_disk_used_pct: (i) => (i.min_disk_free_pct != null ? 100 - i.min_disk_free_pct : null),
  max_disk_used_pct: (i) => i.max_disk_used_pct,
  max_disk_io_kbps: (i) => (i.max_disk_io_kbps != null ? i.max_disk_io_kbps / 1024 : null),
  availability_pct: (i) => i.availability_pct,
};

export default function Resources() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [days, setDaysState] = useState(() => {
    const d = Number(searchParams.get("days"));
    return [7, 14, 30, 60, 90].includes(d) ? d : 30;
  });
  const [filter, setFilterState] = useState<ResourceItem["resource_status"] | "all" | "needs_attention">(() => {
    const f = searchParams.get("filter") ?? "all";
    return (["all", "needs_attention", "optimal", "oversized", "undersized", "no_data"] as const).includes(f as never) ? f as ResourceItem["resource_status"] | "all" | "needs_attention" : "all";
  });
  const [search, setSearchState] = useState(() => searchParams.get("search") ?? "");
  const [cluster, setClusterState] = useState(() => searchParams.get("cluster") ?? "");

  function setDays(v: number) {
    setDaysState(v);
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set("days", String(v)); return next; }, { replace: true });
  }
  function setFilter(v: ResourceItem["resource_status"] | "all" | "needs_attention") {
    setFilterState(v);
    setSearchParams((prev) => { const next = new URLSearchParams(prev); if (v === "all") next.delete("filter"); else next.set("filter", v); return next; }, { replace: true });
  }
  function setSearch(v: string) {
    setSearchState(v);
    setSearchParams((prev) => { const next = new URLSearchParams(prev); if (!v) next.delete("search"); else next.set("search", v); return next; }, { replace: true });
  }
  function setCluster(v: string) {
    setClusterState(v);
    setSearchParams((prev) => { const next = new URLSearchParams(prev); if (!v) next.delete("cluster"); else next.set("cluster", v); return next; }, { replace: true });
  }

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["resources", days],
    queryFn: () => api.resources(days),
  });
  const [osFamily, setOsFamily] = useState("");
  const [groupByCluster, setGroupByCluster] = useState(false);
  const [page, setPage] = useState(1);
  const [columnFilters, setColumnFilters] = useState<Partial<Record<ColumnKey, Set<string>>>>({});
  const [numericFilters, setNumericFilters] = useState<Partial<Record<NumericColumnKey, NumberRange>>>({});
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(
    () => new Set(VISIBLE_COLUMNS.map((c) => c.key as ColKey))
  );
  const [selectedVm, setSelectedVm] = useState<string | null>(null);

  const showCol = (key: ColKey) => visibleCols.has(key);

  useEffect(() => {
    setPage(1);
  }, [filter, search, cluster, osFamily, days, columnFilters, numericFilters, groupByCluster]);

  function setColumnFilter(key: ColumnKey, value: Set<string> | null) {
    setColumnFilters((prev) => {
      const next = { ...prev };
      if (!value || value.size === 0) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function setNumericFilter(key: NumericColumnKey, value: NumberRange | null) {
    setNumericFilters((prev) => {
      const next = { ...prev };
      if (value === null) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  const columnOptions = useMemo(() => {
    const all = data?.items ?? [];
    const result = {} as Record<ColumnKey, string[]>;
    for (const key of Object.keys(columnValue) as ColumnKey[]) {
      result[key] = Array.from(new Set(all.map(columnValue[key]))).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
      );
    }
    return result;
  }, [data]);

  const clusters = Array.from(
    new Set((data?.items ?? []).map((i) => i.cluster).filter((c): c is string => !!c))
  ).sort();
  const osFamilies = Array.from(
    new Set((data?.items ?? []).map((i) => i.os_family).filter((o): o is string => !!o))
  ).sort();

  const filteredItems = (data?.items ?? []).filter((i) => {
    if (filter === "needs_attention" && i.resource_status !== "oversized" && i.resource_status !== "undersized") return false;
    if (filter !== "all" && filter !== "needs_attention" && i.resource_status !== filter) return false;
    if (cluster && i.cluster !== cluster) return false;
    if (osFamily && i.os_family !== osFamily) return false;
    if (search) {
      const q = search.toLowerCase();
      const matches =
        i.name.toLowerCase().includes(q) ||
        (i.fqdn ?? "").toLowerCase().includes(q) ||
        (i.primary_ip ?? "").toLowerCase().includes(q);
      if (!matches) return false;
    }
    for (const key of Object.keys(columnFilters) as ColumnKey[]) {
      const selected = columnFilters[key];
      if (selected && selected.size > 0 && !selected.has(columnValue[key](i))) return false;
    }
    for (const key of Object.keys(numericFilters) as NumericColumnKey[]) {
      const range = numericFilters[key];
      if (!range) continue;
      const v = numericColumnValue[key](i);
      if (v == null) return false;
      if (range.min !== undefined && v < range.min) return false;
      if (range.max !== undefined && v > range.max) return false;
    }
    return true;
  });

  // Grouping by cluster
  type TableRow =
    | { type: "header"; cluster: string; count: number }
    | { type: "item"; item: ResourceItem };

  const tableRows: TableRow[] = useMemo(() => {
    if (!groupByCluster) return filteredItems.map((item) => ({ type: "item" as const, item }));
    const sorted = [...filteredItems].sort((a, b) => {
      const ca = a.cluster ?? "zzz";
      const cb = b.cluster ?? "zzz";
      return ca.localeCompare(cb) || a.name.localeCompare(b.name);
    });
    const rows: TableRow[] = [];
    let lastCluster: string | null | undefined = undefined;
    for (const item of sorted) {
      if (item.cluster !== lastCluster) {
        const count = sorted.filter((i) => i.cluster === item.cluster).length;
        rows.push({ type: "header", cluster: item.cluster ?? "Без кластера", count });
        lastCluster = item.cluster;
      }
      rows.push({ type: "item", item });
    }
    return rows;
  }, [filteredItems, groupByCluster]);

  const totalPages = groupByCluster
    ? 1
    : Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const pageRows = groupByCluster
    ? tableRows
    : tableRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleExport() {
    const rows = filteredItems.map((i) => ({
      "ВМ": i.name,
      "FQDN": i.fqdn ?? "",
      "IP": i.primary_ip ?? "",
      "Кластер": i.cluster ?? "",
      "OS": i.os_family ?? "",
      "vCPU": i.vcpu ?? "",
      "vRAM (GB)": i.vram_gb ?? "",
      "CPU % (середнє)": i.avg_cpu_pct ?? "",
      "CPU % (пік)": i.max_cpu_pct ?? "",
      "Тренд CPU Δ%": i.trend_cpu_delta ?? "",
      "RAM % (середнє)": i.avg_ram_pct ?? "",
      "RAM % (пік)": i.max_ram_pct ?? "",
      "Тренд RAM Δ%": i.trend_ram_delta ?? "",
      "Доступність %": i.availability_pct ?? "",
      "Диск % вик. Zabbix (серед.)": i.avg_disk_free_pct != null ? +(100 - i.avg_disk_free_pct).toFixed(1) : "",
      "Диск % вик. Zabbix (пік)": i.min_disk_free_pct != null ? +(100 - i.min_disk_free_pct).toFixed(1) : "",
      "CPU % vCenter (серед.)": i.vc_avg_cpu_pct ?? "",
      "CPU % vCenter (пік)": i.vc_max_cpu_pct ?? "",
      "RAM % vCenter (серед.)": i.vc_avg_ram_pct ?? "",
      "RAM % vCenter (пік)": i.vc_max_ram_pct ?? "",
      "Диск % (серед.)": i.avg_disk_used_pct ?? "",
      "Диск % (пік)": i.max_disk_used_pct ?? "",
      "Disk I/O КБ/с (серед.)": i.avg_disk_io_kbps ?? "",
      "Disk I/O КБ/с (пік)": i.max_disk_io_kbps ?? "",
      "Рек. vCPU": i.recommended_vcpu ?? "",
      "Рек. vRAM GB": i.recommended_vram_gb ?? "",
      "Статус": statusLabel[i.resource_status],
      "Рекомендації": i.recommendations.join("; "),
    }));
    exportToXlsx(
      `resources_${new Date().toISOString().slice(0, 10)}.xlsx`,
      "Ресурси ВМ",
      rows
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-800">Аналіз ресурсів ВМ</h1>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-500">
            Період:&nbsp;
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              <option value={7}>7 днів</option>
              <option value={14}>14 днів</option>
              <option value={30}>30 днів</option>
              <option value={90}>90 днів</option>
            </select>
          </label>
          <ColumnVisibilityDropdown
            columns={VISIBLE_COLUMNS}
            visible={visibleCols}
            onChange={(v) => setVisibleCols(v as Set<ColKey>)}
          />
          <button
            onClick={handleExport}
            className="text-sm px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition"
          >
            Експорт в Excel
          </button>
          <button
            onClick={() => refetch()}
            className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
          >
            Оновити
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Середнє використання CPU / RAM / Диск — Zabbix + vCenter за останні {days} днів. Тренд: поточний period vs попередній.
      </p>

      {data && (
        <div className="flex gap-3 mb-5 flex-wrap">
          {(
            [
              { key: "all",             label: `Всі (${data.total})` },
              { key: "needs_attention", label: `Потребують уваги (${data.oversized + data.undersized})`, accent: true },
              { key: "optimal",         label: `Оптимальні (${data.optimal})` },
              { key: "oversized",       label: `Oversized (${data.oversized})` },
              { key: "undersized",      label: `Undersized (${data.undersized})` },
              { key: "no_data",         label: `Без даних (${data.no_data})` },
            ] as { key: typeof filter; label: string; accent?: boolean }[]
          ).map(({ key, label, accent }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ` +
                (filter === key
                  ? accent
                    ? "bg-amber-500 text-white border-amber-500"
                    : "bg-blue-600 text-white border-blue-600"
                  : accent
                    ? "bg-amber-50 text-amber-700 border-amber-300 hover:border-amber-500"
                    : "bg-white text-gray-600 border-gray-300 hover:border-blue-400")}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input
          type="text"
          placeholder="Пошук за назвою, FQDN, IP..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-400"
        />
        <select
          value={cluster}
          onChange={(e) => setCluster(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
        >
          <option value="">Всі кластери</option>
          {clusters.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={osFamily}
          onChange={(e) => setOsFamily(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
        >
          <option value="">Всі OS</option>
          {osFamilies.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={groupByCluster}
            onChange={(e) => setGroupByCluster(e.target.checked)}
            className="w-4 h-4 accent-blue-600"
          />
          Групувати по кластеру
        </label>
        {filteredItems.length !== (data?.total ?? 0) && (
          <span className="text-xs text-gray-400">Показано: {filteredItems.length}</span>
        )}
      </div>

      {isLoading && <p className="text-gray-400 animate-pulse">Завантаження...</p>}
      {error && <p className="text-red-500 text-sm">Помилка: {String(error)}</p>}

      {!isLoading && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-300px)]">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left">
                  <div className="flex items-center">
                    ВМ
                    <ColumnFilterDropdown
                      options={columnOptions.name}
                      selected={columnFilters.name ?? null}
                      onChange={(v) => setColumnFilter("name", v)}
                    />
                  </div>
                </th>
                {showCol("cluster") && (
                  <th className="px-4 py-3 text-left">
                    <div className="flex items-center">
                      Кластер
                      <ColumnFilterDropdown
                        options={columnOptions.cluster}
                        selected={columnFilters.cluster ?? null}
                        onChange={(v) => setColumnFilter("cluster", v)}
                      />
                    </div>
                  </th>
                )}
                {showCol("os_family") && (
                  <th className="px-4 py-3 text-left">
                    <div className="flex items-center">
                      OS
                      <ColumnFilterDropdown
                        options={columnOptions.os_family}
                        selected={columnFilters.os_family ?? null}
                        onChange={(v) => setColumnFilter("os_family", v)}
                      />
                    </div>
                  </th>
                )}
                {showCol("vcpu") && (
                  <th className="px-4 py-3 text-left">
                    <div className="flex items-center">
                      vCPU
                      <ColumnFilterDropdown
                        options={columnOptions.vcpu}
                        selected={columnFilters.vcpu ?? null}
                        onChange={(v) => setColumnFilter("vcpu", v)}
                      />
                    </div>
                  </th>
                )}
                {showCol("vram_gb") && (
                  <th className="px-4 py-3 text-left">
                    <div className="flex items-center">
                      vRAM
                      <ColumnFilterDropdown
                        options={columnOptions.vram_gb}
                        selected={columnFilters.vram_gb ?? null}
                        onChange={(v) => setColumnFilter("vram_gb", v)}
                      />
                    </div>
                  </th>
                )}
                {showCol("cpu_pik") && (
                  <th className="px-2 py-3 text-left w-44">
                    <div className="flex items-center">
                      CPU % (пік)
                      <NumberRangeFilterDropdown
                        value={numericFilters.max_cpu_pct ?? null}
                        onChange={(v) => setNumericFilter("max_cpu_pct", v)}
                      />
                    </div>
                  </th>
                )}
                {showCol("ram_pik") && (
                  <th className="px-2 py-3 text-left w-44">
                    <div className="flex items-center">
                      RAM % (пік)
                      <NumberRangeFilterDropdown
                        value={numericFilters.max_ram_pct ?? null}
                        onChange={(v) => setNumericFilter("max_ram_pct", v)}
                      />
                    </div>
                  </th>
                )}
                {showCol("disk_zbx") && (
                  <th className="px-2 py-3 text-left w-36">
                    <div className="flex items-center">
                      Диск % (Zabbix)
                      <NumberRangeFilterDropdown
                        value={numericFilters.zbx_disk_used_pct ?? null}
                        onChange={(v) => setNumericFilter("zbx_disk_used_pct", v)}
                      />
                    </div>
                  </th>
                )}
                {showCol("cpu_vc") && (
                  <th className="px-2 py-3 text-left w-36">
                    <div className="flex items-center">
                      CPU % (vCenter)
                      <NumberRangeFilterDropdown
                        value={numericFilters.vc_max_cpu_pct ?? null}
                        onChange={(v) => setNumericFilter("vc_max_cpu_pct", v)}
                      />
                    </div>
                  </th>
                )}
                {showCol("ram_vc") && (
                  <th className="px-2 py-3 text-left w-36">
                    <div className="flex items-center">
                      RAM % (vCenter)
                      <NumberRangeFilterDropdown
                        value={numericFilters.vc_max_ram_pct ?? null}
                        onChange={(v) => setNumericFilter("vc_max_ram_pct", v)}
                      />
                    </div>
                  </th>
                )}
                {showCol("disk_pct") && (
                  <th className="px-2 py-3 text-left w-36">
                    <div className="flex items-center">
                      Диск % (vCenter)
                      <NumberRangeFilterDropdown
                        value={numericFilters.max_disk_used_pct ?? null}
                        onChange={(v) => setNumericFilter("max_disk_used_pct", v)}
                      />
                    </div>
                  </th>
                )}
                {showCol("disk_io") && (
                  <th className="px-2 py-3 text-left w-36">
                    <div className="flex items-center">
                      Disk I/O (сер./пік)
                      <NumberRangeFilterDropdown
                        value={numericFilters.max_disk_io_kbps ?? null}
                        onChange={(v) => setNumericFilter("max_disk_io_kbps", v)}
                        unit="МБ/с"
                      />
                    </div>
                  </th>
                )}
                {showCol("availability") && (
                  <th className="px-3 py-3 text-left">
                    <div className="flex items-center">
                      Доступн.
                      <NumberRangeFilterDropdown
                        value={numericFilters.availability_pct ?? null}
                        onChange={(v) => setNumericFilter("availability_pct", v)}
                        unit="%"
                      />
                    </div>
                  </th>
                )}
                {showCol("rightsizing") && (
                  <th className="px-3 py-3 text-left whitespace-nowrap">Right-sizing</th>
                )}
                {showCol("status") && (
                  <th className="px-4 py-3 text-left">
                    <div className="flex items-center">
                      Статус
                      <ColumnFilterDropdown
                        options={columnOptions.resource_status}
                        selected={columnFilters.resource_status ?? null}
                        onChange={(v) => setColumnFilter("resource_status", v)}
                      />
                    </div>
                  </th>
                )}
                {showCol("recommendations") && (
                  <th className="px-4 py-3 text-left min-w-[20rem]">Рекомендації</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageRows.map((row, idx) => {
                if (row.type === "header") {
                  const colSpan = visibleCols.size + 1;
                  return (
                    <tr key={`h-${row.cluster}`} className="bg-blue-50">
                      <td colSpan={colSpan} className="px-4 py-2 text-xs font-semibold text-blue-700 uppercase tracking-wide">
                        {row.cluster} <span className="text-blue-400 font-normal ml-1">({row.count} ВМ)</span>
                      </td>
                    </tr>
                  );
                }

                const item = row.item;
                return (
                  <tr key={item.name + idx} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium">
                      <button
                        onClick={() => setSelectedVm(item.name)}
                        className="text-blue-600 hover:underline text-left"
                        title="Історія метрик"
                      >
                        {item.name}
                      </button>
                    </td>
                    {showCol("cluster") && (
                      <td className="px-4 py-2.5 text-gray-500">{item.cluster ?? "—"}</td>
                    )}
                    {showCol("os_family") && (
                      <td className="px-4 py-2.5 text-gray-500">{item.os_family ?? "—"}</td>
                    )}
                    {showCol("vcpu") && (
                      <td className="px-4 py-2.5 text-center">{item.vcpu ?? "—"}</td>
                    )}
                    {showCol("vram_gb") && (
                      <td className="px-4 py-2.5 text-center">
                        {item.vram_gb != null ? `${item.vram_gb} GB` : "—"}
                      </td>
                    )}
                    {showCol("cpu_pik") && (
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-1">
                          <ResourceBar pct={item.avg_cpu_pct} peakPct={item.max_cpu_pct} />
                          <TrendBadge delta={item.trend_cpu_delta} />
                        </div>
                      </td>
                    )}
                    {showCol("ram_pik") && (
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-1">
                          <ResourceBar pct={item.avg_ram_pct} peakPct={item.max_ram_pct} />
                          <TrendBadge delta={item.trend_ram_delta} />
                        </div>
                      </td>
                    )}
                    {showCol("disk_zbx") && (
                      <td className="px-2 py-2.5">
                        <ResourceBar
                          pct={item.avg_disk_free_pct != null ? 100 - item.avg_disk_free_pct : null}
                          peakPct={item.min_disk_free_pct != null ? 100 - item.min_disk_free_pct : null}
                        />
                      </td>
                    )}
                    {showCol("cpu_vc") && (
                      <td className="px-2 py-2.5">
                        <ResourceBar pct={item.vc_avg_cpu_pct} peakPct={item.vc_max_cpu_pct} />
                      </td>
                    )}
                    {showCol("ram_vc") && (
                      <td className="px-2 py-2.5">
                        <ResourceBar pct={item.vc_avg_ram_pct} peakPct={item.vc_max_ram_pct} />
                      </td>
                    )}
                    {showCol("disk_pct") && (
                      <td className="px-2 py-2.5">
                        <ResourceBar pct={item.avg_disk_used_pct} peakPct={item.max_disk_used_pct} />
                      </td>
                    )}
                    {showCol("disk_io") && (
                      <td className="px-2 py-2.5 text-xs text-gray-600 whitespace-nowrap">
                        {item.avg_disk_io_kbps != null
                          ? `${(item.avg_disk_io_kbps / 1024).toFixed(1)} / ${(item.max_disk_io_kbps! / 1024).toFixed(1)} МБ/с`
                          : "—"}
                      </td>
                    )}
                    {showCol("availability") && (
                      <td className="px-3 py-2.5 text-center">
                        <AvailBadge pct={item.availability_pct} />
                      </td>
                    )}
                    {showCol("rightsizing") && (
                      <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">
                        {(item.recommended_vcpu != null || item.recommended_vram_gb != null) ? (
                          <span className="inline-flex gap-2">
                            {item.recommended_vcpu != null && item.vcpu != null && (
                              <span className={item.recommended_vcpu < item.vcpu ? "text-blue-600" : "text-orange-600"}>
                                CPU: {item.vcpu}→{item.recommended_vcpu}
                              </span>
                            )}
                            {item.recommended_vram_gb != null && item.vram_gb != null && (
                              <span className={item.recommended_vram_gb < item.vram_gb ? "text-blue-600" : "text-orange-600"}>
                                RAM: {item.vram_gb}→{item.recommended_vram_gb} GB
                              </span>
                            )}
                          </span>
                        ) : "—"}
                      </td>
                    )}
                    {showCol("status") && (
                      <td className="px-4 py-2.5">
                        <StatusBadge
                          label={statusLabel[item.resource_status]}
                          variant={statusVariant(item.resource_status)}
                        />
                      </td>
                    )}
                    {showCol("recommendations") && (
                      <td className="px-4 py-2.5 text-gray-600 max-w-xl">
                        {item.recommendations.length > 0 ? (
                          <ul className="space-y-0.5">
                            {item.recommendations.map((r, i) => (
                              <li key={i} className="text-xs">{r}</li>
                            ))}
                          </ul>
                        ) : "—"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          {filteredItems.length === 0 && (
            <p className="text-center py-8 text-gray-400 text-sm">Нічого не знайдено</p>
          )}
        </div>
      )}

      {!isLoading && !groupByCluster && filteredItems.length > 0 && (
        <>
          <p className="text-center text-xs text-gray-400 mt-3">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredItems.length)} з {filteredItems.length}
          </p>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}

      {selectedVm && (
        <ResourceHistoryModal name={selectedVm} onClose={() => setSelectedVm(null)} />
      )}
    </div>
  );
}
