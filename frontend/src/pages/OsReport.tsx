import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type OsProgressItem, type OsServerItem, type OsSummaryItem, type OsStatus, type OsUpgradedServerItem } from "../api/client";
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

// ── Progress tab ──────────────────────────────────────────────────────────────

function DeltaChip({ delta, invertColor = false }: { delta: number | null; invertColor?: boolean }) {
  if (delta === null) return <span className="text-gray-300 text-xs">—</span>;
  if (delta === 0) return <span className="text-gray-400 text-xs font-mono">±0</span>;

  // invertColor=true means "negative delta is good" (eol_delta < 0 = fewer EOL = green)
  const isGood = invertColor ? delta < 0 : delta > 0;
  const color = isGood ? "text-green-700 bg-green-50" : "text-red-700 bg-red-50";
  const sign = delta > 0 ? "+" : "";
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-mono font-semibold ${color}`}>
      {sign}{delta}
    </span>
  );
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  if (max === 0) return null;
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

// ── Upgraded servers panel ────────────────────────────────────────────────────

const UPGRADE_ARROW: Record<OsStatus, string> = {
  eol:         "bg-red-100 text-red-700",
  ending_soon: "bg-amber-100 text-amber-700",
  supported:   "bg-green-100 text-green-700",
  unknown:     "bg-gray-100 text-gray-500",
};

function UpgradedServersPanel({ servers }: { servers: OsUpgradedServerItem[] }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  if (servers.length === 0) {
    return (
      <div className="mb-5 p-4 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-500">
        Оновлених серверів не виявлено — або бейслайн містить лише підсумки (збережіть новий бейслайн для порівняння на рівні серверів).
      </div>
    );
  }

  const filtered = search
    ? servers.filter((s) => {
        const q = search.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          (s.os_product ?? "").toLowerCase().includes(q) ||
          (s.cluster ?? "").toLowerCase().includes(q)
        );
      })
    : servers;

  // Group by upgrade direction for summary
  const byDirection = servers.reduce<Record<string, number>>((acc, s) => {
    const key = `${s.old_status}→${s.new_status}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="mb-5 border border-green-200 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-green-50 hover:bg-green-100 transition text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          <span className="text-green-700 font-semibold text-sm">
            Оновлені сервери
          </span>
          <span className="inline-block px-2 py-0.5 rounded-full bg-green-600 text-white text-xs font-bold">
            {servers.length}
          </span>
          {/* Direction chips */}
          <div className="hidden sm:flex flex-wrap gap-1">
            {Object.entries(byDirection).map(([dir, cnt]) => {
              const [from, to] = dir.split("→") as [OsStatus, OsStatus];
              return (
                <span key={dir} className="flex items-center gap-1 text-xs bg-white border border-green-200 rounded-full px-2 py-0.5">
                  <span className={`px-1 rounded ${UPGRADE_ARROW[from]}`}>{STATUS_LABEL[from]}</span>
                  <span className="text-gray-400">→</span>
                  <span className={`px-1 rounded ${UPGRADE_ARROW[to]}`}>{STATUS_LABEL[to]}</span>
                  <span className="font-semibold text-gray-600 ml-0.5">{cnt}</span>
                </span>
              );
            })}
          </div>
        </div>
        <span className="text-gray-400 text-xs select-none">{open ? "▲" : "▼"}</span>
      </button>

      {/* Expanded table */}
      {open && (
        <div className="bg-white">
          <div className="px-4 py-2 border-b border-gray-100">
            <input
              type="text"
              placeholder="Пошук за назвою, ОС, кластером..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full max-w-sm px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:border-blue-400"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">Сервер</th>
                  <th className="px-4 py-2 text-left">Операційна система</th>
                  <th className="px-4 py-2 text-left">Кластер</th>
                  <th className="px-4 py-2 text-left">Статус до</th>
                  <th className="px-4 py-2 text-left">Статус після</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((srv) => (
                  <tr key={srv.name} className="hover:bg-green-50 transition-colors">
                    <td className="px-4 py-2 font-medium text-gray-800 whitespace-nowrap">
                      {srv.name}
                      {srv.fqdn && <div className="text-xs text-gray-400 font-normal">{srv.fqdn}</div>}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-600">
                      {srv.os_product ?? (srv.os_raw?.replace(/^OS-/, "") ?? "—")}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">{srv.cluster ?? "—"}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[srv.old_status]}`}>
                        {STATUS_LABEL[srv.old_status]}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[srv.new_status]}`}>
                        {STATUS_LABEL[srv.new_status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <p className="text-center py-4 text-gray-400 text-sm">Нічого не знайдено</p>
          )}
        </div>
      )}
    </div>
  );
}

function ProgressTab({ allServers }: { allServers: OsServerItem[] }) {
  const queryClient = useQueryClient();
  const [labelInput, setLabelInput] = useState("");
  const [showLabelInput, setShowLabelInput] = useState(false);
  const [statusFilter, setStatusFilter] = useState<OsStatus | "all">("all");
  const [search, setSearch] = useState("");

  // Map: os_product+status → servers (or os_raw if no product).
  // Mirrors the grouping key used in the backend get_os_report().
  const serversByKey = useMemo<Map<string, OsServerItem[]>>(() => {
    const map = new Map<string, OsServerItem[]>();
    for (const srv of allServers) {
      if (srv.os_raw == null) continue;
      const k = srv.os_product
        ? `${srv.os_product}|${srv.os_status}|${srv.eol_date ?? ""}`
        : srv.os_raw;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(srv);
    }
    return map;
  }, [allServers]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["osProgress"],
    queryFn: api.osProgress,
  });

  const mutation = useMutation({
    mutationFn: () => api.setOsBaseline(labelInput.trim() || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["osProgress"] });
      setShowLabelInput(false);
      setLabelInput("");
    },
  });

  if (isLoading) return <div className="text-gray-400 py-8 text-center">Завантаження...</div>;
  if (error) return <div className="text-red-500 py-8 text-center text-sm">Помилка завантаження: {String(error)}</div>;
  if (!data) return <div className="text-gray-400 py-8 text-center">Немає даних</div>;

  const hasBaseline = data.baseline_taken_at != null;

  // Filtered + searched items
  const filteredItems = (data.items ?? []).filter((item) => {
    if (statusFilter !== "all" && item.current_status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        item.os_raw.toLowerCase().includes(q) ||
        (item.os_product ?? "").toLowerCase().includes(q) ||
        (item.os_vendor ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const baselineDate = hasBaseline
    ? new Date(data.baseline_taken_at!).toLocaleDateString("uk-UA", { day: "numeric", month: "long", year: "numeric" })
    : null;
  const daysAgo = hasBaseline
    ? Math.floor((Date.now() - new Date(data.baseline_taken_at!).getTime()) / 86400000)
    : null;

  // "Upgrade progress": how many servers moved from (eol+ending_soon) to supported
  const problematicReduced =
    data.eol_delta !== null && data.ending_soon_delta !== null
      ? -(data.eol_delta + data.ending_soon_delta)
      : null;

  return (
    <>
      {/* Baseline info / set baseline */}
      {hasBaseline ? (
        <div className="flex items-center justify-between flex-wrap gap-3 mb-5 p-4 bg-blue-50 border border-blue-100 rounded-xl">
          <div>
            <p className="text-sm font-semibold text-blue-800">
              Базова лінія зафіксована: {baselineDate}
              {daysAgo !== null && (
                <span className="ml-2 font-normal text-blue-600">({daysAgo} дн. тому)</span>
              )}
              {data.baseline_label && (
                <span className="ml-2 text-blue-500 italic">· {data.baseline_label}</span>
              )}
            </p>
            <p className="text-xs text-blue-600 mt-0.5">
              Стан на той момент: {data.baseline_total} серверів · EOL {data.baseline_eol} · Закінчується {data.baseline_ending_soon} · Підтримується {data.baseline_supported}
            </p>
          </div>
          {!showLabelInput ? (
            <button
              onClick={() => setShowLabelInput(true)}
              className="text-xs text-blue-600 underline hover:text-blue-800 shrink-0"
            >
              Оновити базову лінію
            </button>
          ) : (
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="text"
                placeholder="Мітка (необов'язково)"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                className="border border-blue-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
                className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {mutation.isPending ? "..." : "Зберегти"}
              </button>
              <button onClick={() => setShowLabelInput(false)} className="text-xs text-gray-500 hover:text-gray-700">
                Скасувати
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="mb-5 p-5 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-sm font-semibold text-amber-800 mb-1">Базову лінію не зафіксовано</p>
          <p className="text-xs text-amber-700 mb-3">
            Збережіть поточний стан як базову лінію, щоб надалі відстежувати прогрес оновлення операційних систем.
          </p>
          {!showLabelInput ? (
            <button
              onClick={() => setShowLabelInput(true)}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700"
            >
              Зафіксувати базову лінію зараз
            </button>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                placeholder="Мітка (наприклад: Початок Q3 2026)"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                className="border border-amber-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500 min-w-[260px]"
              />
              <button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
              >
                {mutation.isPending ? "Збереження..." : "Зберегти"}
              </button>
              <button onClick={() => setShowLabelInput(false)} className="text-xs text-gray-500 hover:text-gray-700">
                Скасувати
              </button>
            </div>
          )}
        </div>
      )}

      {/* Progress summary cards */}
      {hasBaseline && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {/* EOL */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">EOL серверів</span>
              <DeltaChip delta={data.eol_delta} invertColor />
            </div>
            <p className="text-2xl font-bold text-red-600">{data.current_eol}</p>
            {data.baseline_eol !== null && (
              <p className="text-xs text-gray-400 mt-0.5">було: {data.baseline_eol}</p>
            )}
            <ProgressBar
              value={data.baseline_eol! - data.current_eol}
              max={data.baseline_eol!}
              color="bg-green-500"
            />
          </div>

          {/* Ending soon */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">Закінчується</span>
              <DeltaChip delta={data.ending_soon_delta} invertColor />
            </div>
            <p className="text-2xl font-bold text-amber-600">{data.current_ending_soon}</p>
            {data.baseline_ending_soon !== null && (
              <p className="text-xs text-gray-400 mt-0.5">було: {data.baseline_ending_soon}</p>
            )}
          </div>

          {/* Supported */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">Підтримується</span>
              <DeltaChip delta={data.supported_delta} />
            </div>
            <p className="text-2xl font-bold text-green-600">{data.current_supported}</p>
            {data.baseline_supported !== null && (
              <p className="text-xs text-gray-400 mt-0.5">було: {data.baseline_supported}</p>
            )}
          </div>

          {/* Overall progress */}
          <div className="bg-white border border-blue-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">Знято з EOL/закінч.</span>
              {problematicReduced !== null && problematicReduced > 0 && (
                <span className="text-xs font-semibold text-green-600">+{problematicReduced}</span>
              )}
            </div>
            <p className={`text-2xl font-bold ${(problematicReduced ?? 0) > 0 ? "text-green-700" : "text-gray-600"}`}>
              {problematicReduced ?? "—"}
            </p>
            {data.baseline_eol !== null && data.baseline_ending_soon !== null && (
              <>
                <p className="text-xs text-gray-400 mt-0.5">
                  із {data.baseline_eol + data.baseline_ending_soon}
                </p>
                <ProgressBar
                  value={problematicReduced ?? 0}
                  max={data.baseline_eol + data.baseline_ending_soon}
                  color="bg-blue-500"
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* Upgraded servers — only when baseline is set */}
      {hasBaseline && (
        <UpgradedServersPanel servers={data.upgraded_servers ?? []} />
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(["all", "eol", "ending_soon", "supported", "unknown"] as const).map((s) => {
          const label = s === "all" ? "Всі" : STATUS_LABEL[s];
          const active = statusFilter === s;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                active
                  ? s === "all" ? "bg-gray-700 text-white border-gray-700" : `${STATUS_COLORS[s]} border-current`
                  : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
              }`}
            >
              {label}
            </button>
          );
        })}
        <input
          type="text"
          placeholder="Пошук за ОС..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto w-full max-w-xs px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:border-blue-400"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-2 py-3 w-6" />
                <th className="px-4 py-3 text-left">Операційна система</th>
                <th className="px-4 py-3 text-left">Вендор</th>
                <th className="px-4 py-3 text-left">Статус зараз</th>
                {hasBaseline && <th className="px-4 py-3 text-left">Статус до</th>}
                {hasBaseline && <th className="px-4 py-3 text-right">Було</th>}
                <th className="px-4 py-3 text-right">Зараз</th>
                {hasBaseline && <th className="px-4 py-3 text-right">Зміна</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredItems.map((item) => {
                const k = item.os_product
                  ? `${item.os_product}|${item.current_status}|${item.eol_date ?? ""}`
                  : item.os_raw;
                const servers = serversByKey.get(k) ?? [];
                return (
                  <ProgressRow
                    key={item.os_raw}
                    item={item}
                    hasBaseline={hasBaseline}
                    servers={servers}
                  />
                );
              })}
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-gray-400">
                    Нічого не знайдено
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function ProgressRow({
  item,
  hasBaseline,
  servers,
}: {
  item: OsProgressItem;
  hasBaseline: boolean;
  servers: OsServerItem[];
}) {
  const [expanded, setExpanded] = useState(false);
  const rowBg = ROW_BG[item.current_status] ?? "";
  const showImproved = hasBaseline && item.baseline_status != null &&
    item.current_status !== item.baseline_status &&
    (STATUS_ORDER[item.baseline_status] ?? 4) > (STATUS_ORDER[item.current_status] ?? 4);

  const colCount = 3 + (hasBaseline ? 3 : 0) + 1; // +1 for expand toggle

  return (
    <>
      <tr
        className={`transition-colors cursor-pointer ${showImproved ? "bg-green-50 hover:bg-green-100" : rowBg}`}
        onClick={() => servers.length > 0 && setExpanded((e) => !e)}
      >
        {/* Expand toggle */}
        <td className="px-2 py-2.5 text-center w-6">
          {servers.length > 0 ? (
            <span className="text-gray-400 hover:text-blue-600 text-xs font-bold select-none">
              {expanded ? "▲" : "▼"}
            </span>
          ) : null}
        </td>

        <td className="px-4 py-2.5">
          <div className="font-medium text-gray-800">
            {item.os_product ?? item.os_raw.replace(/^OS-/, "")}
            {showImproved && (
              <span className="ml-2 inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700 leading-none">
                оновлено
              </span>
            )}
          </div>
          {item.os_product && (
            <div className="text-xs text-gray-400 mt-0.5">{item.os_raw.replace(/^OS-/, "")}</div>
          )}
        </td>
        <td className="px-4 py-2.5 text-xs text-gray-500">{item.os_vendor ?? "—"}</td>
        <td className="px-4 py-2.5">
          <StatusBadge status={item.current_status} />
        </td>
        {hasBaseline && (
          <td className="px-4 py-2.5">
            {item.baseline_status ? (
              <StatusBadge status={item.baseline_status} />
            ) : (
              <span className="text-xs text-blue-600 font-medium">нова</span>
            )}
          </td>
        )}
        {hasBaseline && (
          <td className="px-4 py-2.5 text-right">
            <span className="text-sm text-gray-500">{item.baseline_count ?? "—"}</span>
          </td>
        )}
        <td className="px-4 py-2.5 text-right">
          <span className="text-sm font-semibold text-gray-700">{item.current_count}</span>
        </td>
        {hasBaseline && (
          <td className="px-4 py-2.5 text-right">
            <DeltaChip
              delta={item.delta}
              invertColor={item.current_status === "eol" || item.current_status === "ending_soon"}
            />
          </td>
        )}
      </tr>

      {/* Expanded server sub-rows */}
      {expanded && servers.map((srv) => (
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
          <td className="px-4 py-1.5 text-gray-400">{srv.primary_ip ?? "—"}</td>
          <td className="px-4 py-1.5">
            <span className="text-xs text-gray-400">{srv.ci_type === "vm" ? "VM" : "Фіз."}</span>
          </td>
          <td className="px-4 py-1.5 text-gray-500">{srv.cluster ?? "—"}</td>
          <td colSpan={colCount - 5} />
        </tr>
      ))}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = "os-types" | "servers" | "progress";

export default function OsReport() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["osReport"],
    queryFn: api.osReport,
  });

  const [tab, setTab]                       = useState<Tab>("os-types");
  const [statusCardFilter, setStatusCardFilter] = useState<OsStatus | "all">("all");

  // Status card filter does not apply to the progress tab (it has its own filters)
  const isProgressTab = tab === "progress";

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

      {/* Summary cards — hidden on progress tab (it has its own summary) */}
      {data && !isProgressTab && (
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
          { key: "os-types",  label: "За ОС" },
          { key: "servers",   label: "За серверами" },
          { key: "progress",  label: "Прогрес оновлень" },
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
      {tab === "progress" && (
        <ProgressTab allServers={data?.servers ?? []} />
      )}
    </div>
  );
}
