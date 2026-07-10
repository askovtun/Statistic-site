import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type OsServerItem, type OsSummaryItem, type OsStatus } from "../api/client";
import { exportToXlsx } from "../utils/exportXlsx";
import Pagination from "../components/Pagination";

const PAGE_SIZE = 50;

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<OsStatus, string> = {
  supported:   "Підтримується",
  ending_soon: "Закінчується",
  eol:         "EOL",
  unknown:     "Невідомо",
};

const STATUS_COLORS: Record<OsStatus, string> = {
  supported:   "bg-green-100 text-green-700",
  ending_soon: "bg-amber-100 text-amber-700",
  eol:         "bg-red-100 text-red-700",
  unknown:     "bg-gray-100 text-gray-500",
};

const ROW_BG: Record<OsStatus, string> = {
  supported:   "hover:bg-gray-50",
  ending_soon: "bg-amber-50 hover:bg-amber-100",
  eol:         "bg-red-50 hover:bg-red-100",
  unknown:     "hover:bg-gray-50 opacity-70",
};

const STATUS_ORDER: Record<OsStatus, number> = {
  eol: 0, ending_soon: 1, supported: 2, unknown: 3,
};

function StatusBadge({ status }: { status: OsStatus }) {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function SourceBadge({ fromTools }: { fromTools: boolean }) {
  return fromTools ? (
    <span
      title="ОС визначена з VMware Tools (guest OS)"
      className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 ml-1.5 leading-none align-middle"
    >
      vCenter
    </span>
  ) : (
    <span
      title="ОС з CMDB або конфігурації vmx"
      className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 ml-1.5 leading-none align-middle"
    >
      CMDB
    </span>
  );
}

function EolDateCell({ eolDate }: { eolDate: string | null }) {
  if (!eolDate) return <span className="text-gray-300 text-xs">—</span>;
  return (
    <span className="text-xs text-gray-600">
      {new Date(eolDate).toLocaleDateString("uk-UA", { year: "numeric", month: "short", day: "numeric" })}
    </span>
  );
}

function DaysCell({ days, eolDate }: { days: number | null; eolDate: string | null }) {
  if (days === null || eolDate === null) return <span className="text-gray-300 text-xs">—</span>;
  const fmtDate = new Date(eolDate).toLocaleDateString("uk-UA", { year: "numeric", month: "short", day: "numeric" });
  if (days < 0) {
    return <span className="text-xs text-red-700 font-semibold" title={fmtDate}>{Math.abs(days)} дн. тому</span>;
  }
  const color = days <= 90 ? "text-red-600 font-semibold" : days <= 365 ? "text-amber-600 font-semibold" : "text-gray-600";
  return <span className={`text-xs ${color}`} title={fmtDate}>{days} дн.</span>;
}

// ── Export helper ─────────────────────────────────────────────────────────────

function buildExportRows(
  osItems: OsSummaryItem[],
  serversByOs: Map<string, OsServerItem[]>,
  selectedKeys: Set<string>,
): Record<string, unknown>[] {
  const source = selectedKeys.size > 0
    ? osItems.filter((i) => selectedKeys.has(i.os_raw))
    : osItems;

  const rows: Record<string, unknown>[] = [];
  for (const os of source) {
    const servers = serversByOs.get(os.os_raw) ?? [];
    if (servers.length === 0) {
      rows.push({
        "Операційна система": os.os_product ?? os.os_raw.replace(/^OS-/, ""),
        "Вендор":             os.os_vendor ?? "",
        "Статус":             STATUS_LABEL[os.os_status],
        "Дата EOL":           os.eol_date ?? "",
        "Залишилось (днів)":  os.days_until_eol ?? "",
        "Сервер":             "",
        "Кластер":            "",
        "FQDN":               "",
        "IP":                 "",
      });
    } else {
      for (const srv of servers) {
        rows.push({
          "Операційна система": os.os_product ?? os.os_raw.replace(/^OS-/, ""),
          "Вендор":             os.os_vendor ?? "",
          "Статус":             STATUS_LABEL[os.os_status],
          "Дата EOL":           os.eol_date ?? "",
          "Залишилось (днів)":  os.days_until_eol ?? "",
          "Сервер":             srv.name,
          "Кластер":            srv.cluster ?? "",
          "FQDN":               srv.fqdn ?? "",
          "IP":                 srv.primary_ip ?? "",
        });
      }
    }
  }
  return rows;
}

// ── OS types tab ──────────────────────────────────────────────────────────────

function OsTypesTab({
  items,
  allServers,
}: {
  items: OsSummaryItem[];
  allServers: OsServerItem[];
}) {
  const [search, setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState<OsStatus | "all">("all");
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());
  const [selected, setSelected]   = useState<Set<string>>(new Set());

  // Group servers by os_raw for expandable sub-rows and export
  const serversByOs = useMemo<Map<string, OsServerItem[]>>(() => {
    const map = new Map<string, OsServerItem[]>();
    for (const srv of allServers) {
      const key = srv.os_raw ?? "Невідомо";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(srv);
    }
    return map;
  }, [allServers]);

  const filtered = items.filter((i) => {
    if (statusFilter !== "all" && i.os_status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        i.os_raw.toLowerCase().includes(q) ||
        (i.os_product ?? "").toLowerCase().includes(q) ||
        (i.os_vendor ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Selection helpers
  const allKeys      = filtered.map((i) => i.os_raw);
  const allSelected  = allKeys.length > 0 && allKeys.every((k) => selected.has(k));
  const someSelected = allKeys.some((k) => selected.has(k));

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) { allKeys.forEach((k) => next.delete(k)); }
      else              { allKeys.forEach((k) => next.add(k)); }
      return next;
    });
  }

  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function handleExport() {
    const rows = buildExportRows(filtered, serversByOs, selected);
    const date = new Date().toISOString().slice(0, 10);
    exportToXlsx(`os-report-${date}.xlsx`, "Операційні системи", rows);
  }

  const selectedCount = allKeys.filter((k) => selected.has(k)).length;

  return (
    <>
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(["all", "eol", "ending_soon", "supported", "unknown"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
              statusFilter === s
                ? s === "all"
                  ? "bg-gray-700 text-white border-gray-700"
                  : `${STATUS_COLORS[s]} border-current`
                : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
            }`}
          >
            {s === "all" ? "Всі" : STATUS_LABEL[s]}
          </button>
        ))}
        <input
          type="text"
          placeholder="Пошук за ОС..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto w-full max-w-xs px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:border-blue-400"
        />
      </div>

      {/* Export toolbar */}
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition"
        >
          <span>↓</span>
          {selectedCount > 0
            ? `Експорт вибраних (${selectedCount}) у xlsx`
            : "Експорт всіх у xlsx"}
        </button>
        {selectedCount > 0 && (
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Скасувати вибір
          </button>
        )}
        <span className="text-xs text-gray-400 ml-auto">
          {filtered.length} тип{filtered.length === 1 ? "" : "ів"} ОС
        </span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-3 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </th>
                <th className="px-3 py-3 w-8" />
                <th className="px-4 py-3 text-left">Операційна система</th>
                <th className="px-4 py-3 text-left">Вендор</th>
                <th className="px-4 py-3 text-left">Статус</th>
                <th className="px-4 py-3 text-left">Дата EOL</th>
                <th className="px-4 py-3 text-left">Залишилось</th>
                <th className="px-4 py-3 text-left">Серверів</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((item) => {
                const isExpanded = expanded.has(item.os_raw);
                const isSelected = selected.has(item.os_raw);
                const servers    = serversByOs.get(item.os_raw) ?? [];

                return (
                  <>
                    {/* OS row */}
                    <tr
                      key={item.os_raw}
                      className={`transition-colors cursor-pointer ${
                        isSelected ? "bg-blue-50" : ROW_BG[item.os_status]
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(item.os_raw)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </td>

                      {/* Expand toggle */}
                      <td className="px-2 py-2.5 text-center" onClick={() => toggleExpand(item.os_raw)}>
                        {servers.length > 0 && (
                          <span className="text-gray-400 hover:text-blue-600 text-xs font-bold select-none">
                            {isExpanded ? "▲" : "▼"}
                          </span>
                        )}
                      </td>

                      {/* OS name — clicking row also expands */}
                      <td className="px-4 py-2.5" onClick={() => toggleExpand(item.os_raw)}>
                        <div className="font-medium text-sm text-gray-800">
                          {item.os_product ?? item.os_raw.replace(/^OS-/, "")}
                        </div>
                        {item.os_product && (
                          <div className="text-xs text-gray-400 mt-0.5">{item.os_raw.replace(/^OS-/, "")}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500" onClick={() => toggleExpand(item.os_raw)}>
                        {item.os_vendor ?? "—"}
                      </td>
                      <td className="px-4 py-2.5" onClick={() => toggleExpand(item.os_raw)}>
                        <StatusBadge status={item.os_status} />
                      </td>
                      <td className="px-4 py-2.5" onClick={() => toggleExpand(item.os_raw)}>
                        <EolDateCell eolDate={item.eol_date} />
                      </td>
                      <td className="px-4 py-2.5" onClick={() => toggleExpand(item.os_raw)}>
                        <DaysCell days={item.days_until_eol} eolDate={item.eol_date} />
                      </td>
                      <td className="px-4 py-2.5" onClick={() => toggleExpand(item.os_raw)}>
                        <span className="text-sm font-semibold text-gray-700">{item.server_count}</span>
                      </td>
                    </tr>

                    {/* Expanded server sub-rows */}
                    {isExpanded && servers.map((srv) => (
                      <tr
                        key={`${item.os_raw}::${srv.name}`}
                        className="bg-gray-50 border-l-4 border-blue-200 text-xs text-gray-600"
                      >
                        <td colSpan={2} />
                        <td className="px-4 py-1.5 font-medium text-gray-700 whitespace-nowrap">
                          {srv.name}
                          {srv.fqdn && <span className="ml-2 text-gray-400 font-normal">{srv.fqdn}</span>}
                          {srv.ci_type === "vm" && <SourceBadge fromTools={srv.os_from_tools} />}
                        </td>
                        <td className="px-4 py-1.5 text-gray-400">
                          {srv.primary_ip ?? "—"}
                        </td>
                        <td className="px-4 py-1.5">
                          <span className="text-xs text-gray-400">
                            {srv.ci_type === "vm" ? "VM" : "Фіз."}
                          </span>
                        </td>
                        <td className="px-4 py-1.5 text-gray-500">
                          {srv.cluster ?? "—"}
                        </td>
                        <td colSpan={2} />
                      </tr>
                    ))}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <p className="text-center py-8 text-gray-400 text-sm">Нічого не знайдено</p>
        )}
      </div>
    </>
  );
}

// ── Servers tab ───────────────────────────────────────────────────────────────

type ServerSortKey = "name" | "os_product" | "os_status" | "days_until_eol" | "cluster";

function ServersTab({ items }: { items: OsServerItem[] }) {
  const [search, setSearch]             = useState("");
  const [statusFilter, setStatusFilter] = useState<OsStatus | "all">("all");
  const [clusterFilter, setClusterFilter] = useState("");
  const [vendorFilter, setVendorFilter]   = useState("");
  const [typeFilter, setTypeFilter]       = useState<"all" | "vm" | "physical">("all");
  const [sortKey, setSortKey]           = useState<ServerSortKey>("days_until_eol");
  const [sortDesc, setSortDesc]         = useState(false);
  const [page, setPage]                 = useState(1);

  function toggleSort(k: ServerSortKey) {
    if (sortKey === k) setSortDesc((d) => !d);
    else { setSortKey(k); setSortDesc(k === "days_until_eol" ? false : true); }
    setPage(1);
  }

  function SortTh({ k, label }: { k: ServerSortKey; label: string }) {
    const active = sortKey === k;
    return (
      <th className="px-3 py-3 text-left cursor-pointer select-none hover:text-gray-700 whitespace-nowrap" onClick={() => toggleSort(k)}>
        <span className="flex items-center gap-1">
          {label}
          <span className="text-gray-400">{active ? (sortDesc ? "↓" : "↑") : "↕"}</span>
        </span>
      </th>
    );
  }

  const clusters = Array.from(new Set(items.map((i) => i.cluster).filter(Boolean) as string[])).sort();
  const vendors  = Array.from(new Set(items.map((i) => i.os_vendor).filter(Boolean) as string[])).sort();

  const filtered = items.filter((i) => {
    if (typeFilter !== "all" && i.ci_type !== typeFilter) return false;
    if (statusFilter !== "all" && i.os_status !== statusFilter) return false;
    if (clusterFilter && i.cluster !== clusterFilter) return false;
    if (vendorFilter && i.os_vendor !== vendorFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        i.name.toLowerCase().includes(q) ||
        (i.fqdn ?? "").toLowerCase().includes(q) ||
        (i.primary_ip ?? "").includes(q) ||
        (i.os_raw ?? "").toLowerCase().includes(q) ||
        (i.os_product ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let av: string | number, bv: string | number;
    switch (sortKey) {
      case "days_until_eol":
        av = a.days_until_eol ?? (a.os_status === "unknown" ? 999_999 : 999_998);
        bv = b.days_until_eol ?? (b.os_status === "unknown" ? 999_999 : 999_998);
        break;
      case "os_status":
        av = STATUS_ORDER[a.os_status];
        bv = STATUS_ORDER[b.os_status];
        break;
      case "os_product":
        av = a.os_product ?? a.os_raw ?? "";
        bv = b.os_product ?? b.os_raw ?? "";
        break;
      case "cluster":
        av = a.cluster ?? "";
        bv = b.cluster ?? "";
        break;
      default:
        av = (a as Record<string, unknown>)[sortKey] as string ?? "";
        bv = (b as Record<string, unknown>)[sortKey] as string ?? "";
    }
    if (typeof av === "string" && typeof bv === "string")
      return sortDesc ? bv.localeCompare(av) : av.localeCompare(bv);
    return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number);
  });

  function handleExport() {
    const rows = sorted.map((i) => ({
      "Сервер":               i.name,
      "Тип":                  i.ci_type === "vm" ? "VM" : "Фіз. сервер",
      "Операційна система":   i.os_product ?? (i.os_raw?.replace(/^OS-/, "") ?? ""),
      "Вендор":               i.os_vendor ?? "",
      "Статус":               STATUS_LABEL[i.os_status],
      "Дата EOL":             i.eol_date ?? "",
      "Залишилось (днів)":    i.days_until_eol ?? "",
      "Кластер":              i.cluster ?? "",
      "FQDN":                 i.fqdn ?? "",
      "IP":                   i.primary_ip ?? "",
      "Джерело ОС":           i.ci_type === "vm" ? (i.os_from_tools ? "vCenter (Tools)" : "CMDB") : "",
    }));
    exportToXlsx(`os-servers-${new Date().toISOString().slice(0, 10)}.xlsx`, "Сервери", rows);
  }

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageItems  = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(["all", "eol", "ending_soon", "supported", "unknown"] as const).map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setPage(1); }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
              statusFilter === s
                ? s === "all" ? "bg-gray-700 text-white border-gray-700"
                              : `${STATUS_COLORS[s]} border-current`
                : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
            }`}
          >
            {s === "all" ? "Всі" : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {/* Secondary filters + export */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Пошук за назвою, IP, ОС..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-400"
        />
        <select value={clusterFilter} onChange={(e) => { setClusterFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
          <option value="">Всі кластери</option>
          {clusters.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={vendorFilter} onChange={(e) => { setVendorFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
          <option value="">Всі вендори</option>
          {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value as "all" | "vm" | "physical"); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
          <option value="all">Всі типи</option>
          <option value="vm">VM</option>
          <option value="physical">Фіз. сервер</option>
        </select>
        <button
          onClick={handleExport}
          className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition"
        >
          <span>↓</span> Експорт у xlsx ({sorted.length})
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <SortTh k="name" label="Сервер" />
                <SortTh k="os_product" label="Операційна система" />
                <th className="px-3 py-3 text-left whitespace-nowrap">Вендор</th>
                <SortTh k="cluster" label="Кластер" />
                <SortTh k="os_status" label="Статус" />
                <th className="px-3 py-3 text-left whitespace-nowrap">Дата EOL</th>
                <SortTh k="days_until_eol" label="Залишилось" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageItems.map((item) => (
                <tr key={`${item.ci_type}-${item.name}`} className={`transition-colors ${ROW_BG[item.os_status]}`}>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-gray-800 whitespace-nowrap">{item.name}</div>
                    {item.fqdn && <div className="text-xs text-gray-400 mt-0.5">{item.fqdn}</div>}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="text-sm text-gray-700">
                      {item.os_product ?? (item.os_raw ? item.os_raw.replace(/^OS-/, "") : "—")}
                      {item.ci_type === "vm" && <SourceBadge fromTools={item.os_from_tools} />}
                    </div>
                    {item.os_product && item.os_raw && (
                      <div className="text-xs text-gray-400 mt-0.5">{item.os_raw.replace(/^OS-/, "")}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{item.os_vendor ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-500">{item.cluster ?? "—"}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={item.os_status} /></td>
                  <td className="px-3 py-2.5"><EolDateCell eolDate={item.eol_date} /></td>
                  <td className="px-3 py-2.5"><DaysCell days={item.days_until_eol} eolDate={item.eol_date} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sorted.length === 0 && (
          <p className="text-center py-8 text-gray-400 text-sm">Нічого не знайдено</p>
        )}
      </div>

      {sorted.length > 0 && (
        <>
          <p className="text-center text-xs text-gray-400 mt-3">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} з {sorted.length}
          </p>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = "os-types" | "servers";

export default function OsReport() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["osReport"],
    queryFn: api.osReport,
  });

  const [tab, setTab]                       = useState<Tab>("os-types");
  const [statusCardFilter, setStatusCardFilter] = useState<OsStatus | "all">("all");

  const filteredServers = useMemo(
    () => (data?.servers ?? []).filter((s) => statusCardFilter === "all" || s.os_status === statusCardFilter),
    [data, statusCardFilter],
  );
  const filteredOsTypes = useMemo(
    () => (data?.os_types ?? []).filter((o) => statusCardFilter === "all" || o.os_status === statusCardFilter),
    [data, statusCardFilter],
  );

  if (isLoading) return <div className="p-4 md:p-6 lg:p-8"><p className="text-gray-400 animate-pulse">Завантаження...</p></div>;
  if (error)     return <div className="p-4 md:p-6 lg:p-8"><p className="text-red-500 text-sm">Помилка: {String(error)}</p></div>;

  const cards = data ? [
    { status: "all" as const,            label: "Всього",        count: data.total_servers, colorClass: "text-gray-700 bg-gray-50 border-gray-200" },
    { status: "supported" as OsStatus,   label: "Підтримується", count: data.supported,     colorClass: "text-green-700 bg-green-50 border-green-200" },
    { status: "ending_soon" as OsStatus, label: "Закінчується",  count: data.ending_soon,   colorClass: "text-amber-700 bg-amber-50 border-amber-200" },
    { status: "eol" as OsStatus,         label: "EOL",           count: data.eol,           colorClass: "text-red-700 bg-red-50 border-red-200" },
    { status: "unknown" as OsStatus,     label: "Невідомо",      count: data.unknown,       colorClass: "text-gray-500 bg-gray-50 border-gray-200" },
  ] : [];

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">Операційні системи</h1>
      <p className="text-sm text-gray-500 mb-5">
        Статус підтримки ОС на серверах: терміни EOL, перелік застарілих систем
      </p>

      {/* Summary cards */}
      {data && (
        <div className="flex flex-wrap gap-3 mb-6">
          {cards.map(({ status, label, count, colorClass }) => (
            <button
              key={status}
              onClick={() => setStatusCardFilter(status === statusCardFilter ? "all" : status as OsStatus | "all")}
              className={`flex-1 min-w-[120px] rounded-xl p-4 border-2 transition text-left ${
                statusCardFilter === status ? colorClass : "bg-white border-gray-200 hover:border-gray-300 text-gray-700"
              }`}
            >
              <p className="text-2xl font-bold">{count}</p>
              <p className="text-xs mt-0.5 opacity-80">{label}</p>
            </button>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {([
          { key: "os-types", label: "За ОС" },
          { key: "servers",  label: "За серверами" },
        ] as { key: Tab; label: string }[]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition -mb-px ${
              tab === key
                ? "border-blue-600 text-blue-700 bg-white"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "os-types" && (
        <OsTypesTab items={filteredOsTypes} allServers={filteredServers} />
      )}
      {tab === "servers" && (
        <ServersTab items={filteredServers} />
      )}
    </div>
  );
}
