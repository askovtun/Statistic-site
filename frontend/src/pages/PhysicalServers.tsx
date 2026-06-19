import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type PhysicalServerItem } from "../api/client";
import ResourceBar from "../components/ResourceBar";
import Pagination from "../components/Pagination";
import ResourceHistoryModal from "../components/ResourceHistoryModal";
import ColumnFilterDropdown from "../components/ColumnFilterDropdown";
import ColumnVisibilityDropdown, { type ColumnDef } from "../components/ColumnVisibilityDropdown";
import { exportToXlsx } from "../utils/exportXlsx";

const PAGE_SIZE = 50;

const PERIOD_OPTIONS = [
  { label: "7 днів", value: 7 },
  { label: "14 днів", value: 14 },
  { label: "30 днів", value: 30 },
  { label: "90 днів", value: 90 },
];

type FilterColumnKey = "name" | "fqdn" | "location" | "manufacturer" | "resource_status" | "is_monitored";

const resourceStatusLabel: Record<PhysicalServerItem["resource_status"], string> = {
  undersized: "Undersized",
  oversized: "Oversized",
  optimal: "Оптимально",
  no_data: "Немає даних",
};

const filterColumnValue: Record<FilterColumnKey, (i: PhysicalServerItem) => string> = {
  name: (i) => i.name,
  fqdn: (i) => i.fqdn ?? "—",
  location: (i) => i.location ?? "—",
  manufacturer: (i) => i.manufacturer ?? "—",
  resource_status: (i) => resourceStatusLabel[i.resource_status],
  is_monitored: (i) => (i.is_monitored ? "Моніториться" : "Без агента"),
};

const VISIBLE_COLUMNS: ColumnDef[] = [
  { key: "fqdn",            label: "FQDN" },
  { key: "location",        label: "Локація" },
  { key: "manufacturer",    label: "Виробник" },
  { key: "model",           label: "Модель" },
  { key: "cpu",             label: "CPU" },
  { key: "ram_gb",          label: "RAM GB" },
  { key: "is_monitored",    label: "Моніторинг" },
  { key: "resource_status", label: "Ресурс" },
  { key: "cpu_pct",         label: "CPU % (пік)" },
  { key: "ram_pct",         label: "RAM % (пік)" },
  { key: "disk",            label: "Диск % (вільно)" },
];

type ColKey = typeof VISIBLE_COLUMNS[number]["key"];

export default function PhysicalServers() {
  const [periodDays, setPeriodDays] = useState(30);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [historyServer, setHistoryServer] = useState<string | null>(null);
  const [columnFilters, setColumnFilters] = useState<Partial<Record<FilterColumnKey, Set<string>>>>({});
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(
    () => new Set(VISIBLE_COLUMNS.map((c) => c.key as ColKey))
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ["physical-servers", periodDays],
    queryFn: () => api.physicalServers(periodDays),
  });

  const items = data?.items ?? [];

  useEffect(() => { setPage(1); }, [search, columnFilters, periodDays]);

  const showCol = (key: ColKey) => visibleCols.has(key);

  const columnOptions = useMemo(() => {
    const result = {} as Record<FilterColumnKey, string[]>;
    for (const key of Object.keys(filterColumnValue) as FilterColumnKey[]) {
      result[key] = Array.from(new Set(items.map(filterColumnValue[key]))).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
      );
    }
    return result;
  }, [items]);

  function setColumnFilter(key: FilterColumnKey, value: Set<string> | null) {
    setColumnFilters((prev) => {
      const next = { ...prev };
      if (value === null) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter((i) => {
      if (q && !i.name.toLowerCase().includes(q) &&
          !(i.fqdn ?? "").toLowerCase().includes(q) &&
          !(i.primary_ip ?? "").includes(q)) return false;
      for (const [key, allowed] of Object.entries(columnFilters) as [FilterColumnKey, Set<string>][]) {
        if (allowed.size === 0) return false;
        if (!allowed.has(filterColumnValue[key](i))) return false;
      }
      return true;
    });
  }, [items, search, columnFilters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const hasFilters = search || Object.keys(columnFilters).length > 0;

  function resetFilters() {
    setSearch("");
    setColumnFilters({});
    setPage(1);
  }

  function handleExport() {
    const rows = filtered.map((i) => ({
      "Сервер": i.name,
      "FQDN": i.fqdn ?? "",
      "IP": i.primary_ip ?? "",
      "Локація": i.location ?? "",
      "Виробник": i.manufacturer ?? "",
      "Модель": i.model ?? "",
      "CPU": i.cpu_count != null && i.cpu_cores != null
        ? `${i.cpu_count}×${i.cpu_cores} cores`
        : i.cpu_count != null ? `${i.cpu_count} CPU` : "",
      "RAM GB": i.ram_gb ?? "",
      "Моніторинг": i.is_monitored ? "Так" : "Ні",
      "Ресурс статус": resourceStatusLabel[i.resource_status],
      "CPU % (сер.)": i.avg_cpu_pct ?? "",
      "CPU % (пік)": i.max_cpu_pct ?? "",
      "RAM % (сер.)": i.avg_ram_pct ?? "",
      "RAM % (пік)": i.max_ram_pct ?? "",
      "Диск % (вільно, сер.)": i.avg_disk_free_pct ?? "",
      "Диск % (вільно, мін.)": i.min_disk_free_pct ?? "",
    }));
    exportToXlsx(`physical-servers-${periodDays}d.xlsx`, "Фізичні сервери", rows);
  }

  function filterColHeader(label: string, filterKey: FilterColumnKey, colKey: ColKey) {
    if (!showCol(colKey)) return null;
    return (
      <th className="text-left px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">
        <span className="inline-flex items-center gap-0.5">
          {label}
          <ColumnFilterDropdown
            options={columnOptions[filterKey] ?? []}
            selected={columnFilters[filterKey] ?? null}
            onChange={(v) => setColumnFilter(filterKey, v)}
          />
        </span>
      </th>
    );
  }

  function plainColHeader(label: string, colKey: ColKey) {
    if (!showCol(colKey)) return null;
    return (
      <th className="text-left px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">
        {label}
      </th>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-gray-800">Фізичні сервери</h1>
        <div className="flex gap-2 items-center flex-wrap">
          <select
            value={periodDays}
            onChange={(e) => setPeriodDays(Number(e.target.value))}
            className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white"
          >
            {PERIOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <ColumnVisibilityDropdown
            columns={VISIBLE_COLUMNS}
            visible={visibleCols}
            onChange={setVisibleCols}
          />
          <button
            onClick={handleExport}
            disabled={filtered.length === 0}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-600 hover:border-green-400 hover:text-green-700 transition disabled:opacity-40"
          >
            ↓ Excel
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Фізичні сервери з CMDB · CPU/RAM/Disk метрики з Zabbix
      </p>

      {data && (
        <div className="flex gap-4 mb-6 flex-wrap">
          <div className="bg-white rounded-xl shadow-sm border-l-4 border-blue-500 px-5 py-4">
            <p className="text-xs text-gray-500">Всього серверів</p>
            <p className="text-2xl font-bold">{data.total}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border-l-4 border-green-500 px-5 py-4">
            <p className="text-xs text-gray-500">Моніторяться (Zabbix)</p>
            <p className="text-2xl font-bold text-green-700">{data.monitored}</p>
            <p className="text-xs text-gray-400">
              {data.total ? `${((data.monitored / data.total) * 100).toFixed(0)}%` : ""}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border-l-4 border-gray-400 px-5 py-4">
            <p className="text-xs text-gray-500">Без моніторингу</p>
            <p className="text-2xl font-bold text-gray-500">{data.total - data.monitored}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <input
          type="text"
          placeholder="Пошук (ім'я, FQDN, IP…)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 w-56 focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
        {hasFilters && (
          <button onClick={resetFilters} className="text-xs text-gray-500 hover:text-gray-700 underline">
            Скинути фільтри
          </button>
        )}
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} з {items.length}</span>
      </div>

      {isLoading && <p className="text-gray-400 animate-pulse">Завантаження...</p>}
      {error && <p className="text-red-500 text-sm">Помилка: {String(error)}</p>}

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <div className="max-h-[calc(100vh-340px)] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
                <tr>
                  {/* Сервер — always visible */}
                  <th className="text-left px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">
                    <span className="inline-flex items-center gap-0.5">
                      Сервер
                      <ColumnFilterDropdown
                        options={columnOptions["name"] ?? []}
                        selected={columnFilters["name"] ?? null}
                        onChange={(v) => setColumnFilter("name", v)}
                      />
                    </span>
                  </th>
                  {filterColHeader("FQDN", "fqdn", "fqdn")}
                  {filterColHeader("Локація", "location", "location")}
                  {filterColHeader("Виробник", "manufacturer", "manufacturer")}
                  {plainColHeader("Модель", "model")}
                  {plainColHeader("CPU", "cpu")}
                  {plainColHeader("RAM GB", "ram_gb")}
                  {filterColHeader("Моніторинг", "is_monitored", "is_monitored")}
                  {filterColHeader("Ресурс", "resource_status", "resource_status")}
                  {plainColHeader("CPU % (пік)", "cpu_pct")}
                  {plainColHeader("RAM % (пік)", "ram_pct")}
                  {plainColHeader("Диск % (вільно)", "disk")}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pageItems.map((item) => {
                  const diskUsedPct = item.avg_disk_free_pct != null ? 100 - item.avg_disk_free_pct : null;
                  const diskUsedMax = item.min_disk_free_pct != null ? 100 - item.min_disk_free_pct : null;
                  return (
                    <tr key={item.name} className="hover:bg-gray-50 transition-colors">
                      {/* Сервер — always visible */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <button
                          onClick={() => setHistoryServer(item.name)}
                          className={`font-medium hover:underline text-left ${
                            item.is_monitored ? "text-blue-600" : "text-gray-500"
                          }`}
                          title={item.fqdn ?? item.primary_ip ?? ""}
                        >
                          {item.name}
                        </button>
                        {item.primary_ip && (
                          <p className="text-xs text-gray-400">{item.primary_ip}</p>
                        )}
                      </td>
                      {showCol("fqdn") && (
                        <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                          {item.fqdn ?? "—"}
                        </td>
                      )}
                      {showCol("location") && (
                        <td className="px-3 py-2.5 whitespace-nowrap text-gray-600 text-xs">
                          {item.location ?? "—"}
                        </td>
                      )}
                      {showCol("manufacturer") && (
                        <td className="px-3 py-2.5 whitespace-nowrap text-gray-700 text-xs">
                          {item.manufacturer ?? "—"}
                        </td>
                      )}
                      {showCol("model") && (
                        <td className="px-3 py-2.5 whitespace-nowrap text-xs text-gray-400">
                          {item.model ?? "—"}
                        </td>
                      )}
                      {showCol("cpu") && (
                        <td className="px-3 py-2.5 whitespace-nowrap text-xs text-gray-600">
                          {item.cpu_count != null && item.cpu_cores != null
                            ? `${item.cpu_count}×${item.cpu_cores} cores`
                            : item.cpu_count != null ? `${item.cpu_count} CPU` : "—"}
                        </td>
                      )}
                      {showCol("ram_gb") && (
                        <td className="px-3 py-2.5 text-xs text-gray-600">
                          {item.ram_gb ?? "—"}
                        </td>
                      )}
                      {showCol("is_monitored") && (
                        <td className="px-3 py-2.5 whitespace-nowrap text-xs">
                          {item.is_monitored
                            ? <span className="text-green-600 font-medium">Так</span>
                            : <span className="text-gray-400">Ні</span>}
                        </td>
                      )}
                      {showCol("resource_status") && (
                        <td className="px-3 py-2.5 whitespace-nowrap text-xs text-gray-500">
                          {item.resource_status !== "no_data"
                            ? resourceStatusLabel[item.resource_status]
                            : "—"}
                        </td>
                      )}
                      {showCol("cpu_pct") && (
                        <td className="px-3 py-2.5">
                          <ResourceBar pct={item.avg_cpu_pct} peakPct={item.max_cpu_pct} />
                        </td>
                      )}
                      {showCol("ram_pct") && (
                        <td className="px-3 py-2.5">
                          <ResourceBar pct={item.avg_ram_pct} peakPct={item.max_ram_pct} />
                        </td>
                      )}
                      {showCol("disk") && (
                        <td className="px-3 py-2.5">
                          {diskUsedPct != null
                            ? <ResourceBar pct={diskUsedPct} peakPct={diskUsedMax} />
                            : <span className="text-xs text-gray-300">—</span>}
                        </td>
                      )}
                    </tr>
                  );
                })}
                {!isLoading && pageItems.length === 0 && (
                  <tr>
                    <td colSpan={12} className="text-center py-8 text-gray-400">
                      Немає даних
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {!isLoading && filtered.length > 0 && (
        <>
          <p className="text-center text-xs text-gray-400 mt-3">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} з {filtered.length}
          </p>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}

      {historyServer && (
        <ResourceHistoryModal
          name={historyServer}
          historyFn={(name, days) => api.physicalServerHistory(name, days)}
          onClose={() => setHistoryServer(null)}
          showVCenter={false}
        />
      )}
    </div>
  );
}
