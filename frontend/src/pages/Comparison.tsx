import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ComparisonItem } from "../api/client";
import StatusBadge from "../components/StatusBadge";
import Pagination from "../components/Pagination";
import ColumnFilterDropdown from "../components/ColumnFilterDropdown";
import { exportToXlsx } from "../utils/exportXlsx";

const PAGE_SIZE = 50;

const statusLabel: Record<ComparisonItem["comparison_status"], string> = {
  both: "✅ CMDB + Zabbix",
  cmdb_only: "⚠️ Тільки CMDB",
  zabbix_only: "⚠️ Тільки Zabbix",
};

const statusVariant = (s: ComparisonItem["comparison_status"]) =>
  s === "both" ? "success" : s === "cmdb_only" ? "warning" : "danger";

type FilterKey = "all" | ComparisonItem["comparison_status"];

type ColumnKey = "name" | "fqdn" | "zabbix_name" | "cmdb_status" | "zabbix_status" | "comparison_status";

const columnValue: Record<ColumnKey, (i: ComparisonItem) => string> = {
  name: (i) => i.name,
  fqdn: (i) => i.fqdn ?? "—",
  zabbix_name: (i) => i.zabbix_name ?? "—",
  cmdb_status: (i) => i.cmdb_status ?? "—",
  zabbix_status: (i) => i.zabbix_status ?? "—",
  comparison_status: (i) => statusLabel[i.comparison_status],
};

export default function Comparison() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["comparison"],
    queryFn: api.comparison,
  });
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [cluster, setCluster] = useState("");
  const [osFamily, setOsFamily] = useState("");
  const [page, setPage] = useState(1);
  const [columnFilters, setColumnFilters] = useState<Partial<Record<ColumnKey, Set<string>>>>({});

  useEffect(() => {
    setPage(1);
  }, [filter, search, cluster, osFamily, columnFilters]);

  function setColumnFilter(key: ColumnKey, value: Set<string> | null) {
    setColumnFilters((prev) => {
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

  const items = (data?.items ?? []).filter((i) => {
    if (filter !== "all" && i.comparison_status !== filter) return false;
    if (cluster && i.cluster !== cluster) return false;
    if (osFamily && i.os_family !== osFamily) return false;
    if (search) {
      const q = search.toLowerCase();
      const matches =
        i.name.toLowerCase().includes(q) ||
        (i.fqdn ?? "").toLowerCase().includes(q) ||
        (i.zabbix_name ?? "").toLowerCase().includes(q) ||
        (i.primary_ip ?? "").toLowerCase().includes(q);
      if (!matches) return false;
    }
    for (const key of Object.keys(columnFilters) as ColumnKey[]) {
      const selected = columnFilters[key];
      if (selected && !selected.has(columnValue[key](i))) return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pageItems = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleExport() {
    const rows = items.map((i) => ({
      "Назва": i.name,
      "FQDN (CMDB)": i.fqdn ?? "",
      "Visiable Name (Zabbix)": i.zabbix_name ?? "",
      "Статус CMDB": i.cmdb_status ?? "",
      "Статус Zabbix": i.zabbix_status ?? "",
      "Кластер": i.cluster ?? "",
      "OS": i.os_family ?? "",
      "IP": i.primary_ip ?? "",
      "Результат": statusLabel[i.comparison_status],
    }));
    exportToXlsx(
      `cmdb_vs_zabbix_${new Date().toISOString().slice(0, 10)}.xlsx`,
      "CMDB vs Zabbix",
      rows
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-800">CMDB vs Zabbix</h1>
        <div className="flex gap-2">
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
        Порівняння серверів з Jira CMDB та хостів у Zabbix моніторингу
      </p>

      {/* Summary chips */}
      {data && (
        <div className="flex gap-3 mb-5">
          {(
            [
              { key: "all", label: `Всі (${data.total})` },
              { key: "both", label: `Моніторяться (${data.monitored})` },
              { key: "cmdb_only", label: `Не в Zabbix (${data.cmdb_only})` },
              { key: "zabbix_only", label: `Тіньові (${data.zabbix_only})` },
            ] as { key: FilterKey; label: string }[]
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ` +
                (filter === key
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-300 hover:border-blue-400")}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
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
      </div>

      {isLoading && <p className="text-gray-400 animate-pulse">Завантаження...</p>}
      {error && <p className="text-red-500 text-sm">Помилка: {String(error)}</p>}

      {!isLoading && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">
                  <div className="flex items-center">
                    Назва
                    <ColumnFilterDropdown
                      options={columnOptions.name}
                      selected={columnFilters.name ?? null}
                      onChange={(v) => setColumnFilter("name", v)}
                    />
                  </div>
                </th>
                <th className="px-4 py-3 text-left">
                  <div className="flex items-center">
                    FQDN (CMDB)
                    <ColumnFilterDropdown
                      options={columnOptions.fqdn}
                      selected={columnFilters.fqdn ?? null}
                      onChange={(v) => setColumnFilter("fqdn", v)}
                    />
                  </div>
                </th>
                <th className="px-4 py-3 text-left">
                  <div className="flex items-center">
                    Visiable Name (Zabbix)
                    <ColumnFilterDropdown
                      options={columnOptions.zabbix_name}
                      selected={columnFilters.zabbix_name ?? null}
                      onChange={(v) => setColumnFilter("zabbix_name", v)}
                    />
                  </div>
                </th>
                <th className="px-4 py-3 text-left">
                  <div className="flex items-center">
                    Статус CMDB
                    <ColumnFilterDropdown
                      options={columnOptions.cmdb_status}
                      selected={columnFilters.cmdb_status ?? null}
                      onChange={(v) => setColumnFilter("cmdb_status", v)}
                    />
                  </div>
                </th>
                <th className="px-4 py-3 text-left">
                  <div className="flex items-center">
                    Статус Zabbix
                    <ColumnFilterDropdown
                      options={columnOptions.zabbix_status}
                      selected={columnFilters.zabbix_status ?? null}
                      onChange={(v) => setColumnFilter("zabbix_status", v)}
                    />
                  </div>
                </th>
                <th className="px-4 py-3 text-left">
                  <div className="flex items-center">
                    Результат
                    <ColumnFilterDropdown
                      options={columnOptions.comparison_status}
                      selected={columnFilters.comparison_status ?? null}
                      onChange={(v) => setColumnFilter("comparison_status", v)}
                    />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageItems.map((item) => (
                <tr key={item.name} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium">{item.name}</td>
                  <td className="px-4 py-2.5 text-gray-500">{item.fqdn ?? "—"}</td>
                  <td className="px-4 py-2.5 text-gray-500">
                    {item.zabbix_name
                      ? <span className={item.fqdn && item.zabbix_name.toLowerCase() === item.fqdn.toLowerCase() ? "text-green-600 font-medium" : ""}>{item.zabbix_name}</span>
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {item.cmdb_status ? (
                      <StatusBadge label={item.cmdb_status} variant="info" />
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {item.zabbix_status ? (
                      <StatusBadge
                        label={item.zabbix_status}
                        variant={item.zabbix_status === "enabled" ? "success" : "warning"}
                      />
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge
                      label={statusLabel[item.comparison_status]}
                      variant={statusVariant(item.comparison_status)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 && (
            <p className="text-center py-8 text-gray-400 text-sm">Нічого не знайдено</p>
          )}
        </div>
      )}

      {!isLoading && items.length > 0 && (
        <>
          <p className="text-center text-xs text-gray-400 mt-3">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, items.length)} з {items.length}
          </p>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
