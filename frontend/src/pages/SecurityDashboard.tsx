import { useState } from "react";
import * as XLSX from "xlsx";
import { useQuery } from "@tanstack/react-query";
import { api, type SecurityServerItem, type SecurityDashboardResponse } from "../api/client";
import Pagination from "../components/Pagination";

const PAGE = 50;

// ── XLSX Export ───────────────────────────────────────────────────────────────

function toRows(items: SecurityServerItem[]) {
  return items.map((i) => ({
    "Сервер":     i.name,
    "FQDN":       i.fqdn ?? "",
    "IP":         i.primary_ip ?? "",
    "Кластер":    i.cluster ?? "",
    "ОС":         i.os_product ?? i.os_raw ?? "",
    "Дата EOL":   i.eol_date ?? "",
    "Днів до EOL": i.days_until_eol ?? "",
  }));
}

function exportToXlsx(data: SecurityDashboardResponse) {
  const wb = XLSX.utils.book_new();
  const add = (name: string, items: SecurityServerItem[]) => {
    const ws = XLSX.utils.json_to_sheet(toRows(items));
    ws["!cols"] = [30, 30, 16, 24, 36, 14, 14].map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  add("EOL сервери",          data.eol_items);
  add("Закінчується скоро",   data.ending_soon_items);
  add("VM без моніторингу",   data.unmonitored_vms);
  add("Фіз без моніторингу",  data.unmonitored_phys);
  add("ОС без версії",        data.no_version_items);
  add("ОС невідомо",          data.unknown_os_items);
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `security-dashboard-${date}.xlsx`);
}

// ── Risk Panel ────────────────────────────────────────────────────────────────

function RiskPanel({
  title,
  count,
  accentClass,
  borderClass,
  headerBg,
  items,
  columns,
  emptyText,
}: {
  title: string;
  count: number;
  accentClass: string;
  borderClass: string;
  headerBg: string;
  items: SecurityServerItem[];
  columns: { label: string; render: (i: SecurityServerItem) => React.ReactNode }[];
  emptyText: string;
}) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage]     = useState(1);

  const filtered = search
    ? items.filter((i) => {
        const q = search.toLowerCase();
        return (
          i.name.toLowerCase().includes(q) ||
          (i.cluster ?? "").toLowerCase().includes(q) ||
          (i.fqdn ?? "").toLowerCase().includes(q) ||
          (i.primary_ip ?? "").includes(q) ||
          (i.os_product ?? "").toLowerCase().includes(q) ||
          (i.os_raw ?? "").toLowerCase().includes(q)
        );
      })
    : items;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageItems  = filtered.slice((page - 1) * PAGE, page * PAGE);

  return (
    <div className={`border ${borderClass} rounded-xl overflow-hidden mb-4`}>
      <button
        className={`w-full flex items-center justify-between px-5 py-4 ${headerBg} transition hover:opacity-90 text-left`}
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          <span className={`text-base font-semibold ${accentClass}`}>{title}</span>
          <span className={`inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded-full text-sm font-bold text-white ${
            count > 0 ? "bg-red-500" : "bg-gray-400"
          }`}>
            {count}
          </span>
        </div>
        <span className="text-gray-400 text-sm select-none">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="bg-white dark:bg-slate-900">
          {count === 0 ? (
            <p className="px-5 py-6 text-center text-gray-400 text-sm">{emptyText}</p>
          ) : (
            <>
              <div className="px-4 py-2 border-b border-gray-100 dark:border-slate-700 flex items-center gap-3">
                <input
                  type="text"
                  placeholder="Пошук..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="w-full max-w-sm px-3 py-1.5 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 rounded-lg text-xs focus:outline-none focus:border-blue-400"
                />
                <span className="text-xs text-gray-400 shrink-0">{filtered.length} з {count}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-slate-400 text-xs uppercase">
                    <tr>
                      {columns.map((c) => (
                        <th key={c.label} className="px-4 py-2 text-left whitespace-nowrap">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                    {pageItems.map((item) => (
                      <tr key={`${item.ci_type}-${item.name}`} className="hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                        {columns.map((c) => (
                          <td key={c.label} className="px-4 py-2">{c.render(item)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length > PAGE && (
                <>
                  <p className="text-center text-xs text-gray-400 mt-2">
                    {(page - 1) * PAGE + 1}–{Math.min(page * PAGE, filtered.length)} з {filtered.length}
                  </p>
                  <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Column helpers ────────────────────────────────────────────────────────────

function nameCell(i: SecurityServerItem) {
  return (
    <div>
      <div className="font-medium text-gray-800 dark:text-slate-200 whitespace-nowrap">{i.name}</div>
      {i.fqdn && <div className="text-xs text-gray-400">{i.fqdn}</div>}
    </div>
  );
}

function osCell(i: SecurityServerItem) {
  if (!i.os_product && !i.os_raw) return <span className="text-gray-300 text-xs">—</span>;
  return <span className="text-xs text-gray-700 dark:text-slate-300">{i.os_product ?? i.os_raw}</span>;
}

function osRawCell(i: SecurityServerItem) {
  if (!i.os_raw) return <span className="text-gray-300 text-xs">—</span>;
  return <span className="text-xs text-gray-500 dark:text-slate-400">{i.os_raw}</span>;
}

function eolCell(i: SecurityServerItem) {
  if (!i.eol_date) return <span className="text-gray-300 text-xs">—</span>;
  const days = i.days_until_eol;
  const dateStr = new Date(i.eol_date).toLocaleDateString("uk-UA", { year: "numeric", month: "short", day: "numeric" });
  if (days === null) return <span className="text-xs text-gray-500">{dateStr}</span>;
  const color = days < 0 ? "text-red-700 font-semibold" : days <= 90 ? "text-red-600" : "text-amber-600";
  return (
    <div>
      <div className="text-xs text-gray-500">{dateStr}</div>
      <div className={`text-xs ${color}`}>{days < 0 ? `${Math.abs(days)} дн. тому` : `${days} дн.`}</div>
    </div>
  );
}

function clusterCell(i: SecurityServerItem) {
  return <span className="text-xs text-gray-500 dark:text-slate-400">{i.cluster ?? "—"}</span>;
}

function ipCell(i: SecurityServerItem) {
  return <span className="text-xs text-gray-500 dark:text-slate-400">{i.primary_ip ?? "—"}</span>;
}

// ── Summary Card ──────────────────────────────────────────────────────────────

function SummaryCard({
  label, count, sub, colorClass,
}: {
  label: string; count: number; sub?: string; colorClass: string;
}) {
  return (
    <div className={`rounded-xl border-2 p-4 ${colorClass}`}>
      <p className="text-2xl font-bold">{count}</p>
      <p className="text-sm font-medium mt-0.5">{label}</p>
      {sub && <p className="text-xs mt-0.5 opacity-70">{sub}</p>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SecurityDashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["securityDashboard"],
    queryFn: api.securityDashboard,
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading) return <div className="p-8 text-gray-400 animate-pulse">Завантаження...</div>;
  if (error)     return <div className="p-8 text-red-500 text-sm">Помилка: {String(error)}</div>;
  if (!data)     return null;

  const totalRisk = data.eol_count + data.ending_soon_count + data.unmonitored_vm_count + data.unmonitored_phys_count + data.unknown_os_count + data.no_version_count;

  const eolColumns = [
    { label: "Сервер",              render: nameCell },
    { label: "Операційна система",  render: osCell },
    { label: "Дата EOL / Днів",    render: eolCell },
    { label: "Кластер",            render: clusterCell },
    { label: "IP",                 render: ipCell },
  ];

  const unmonitoredColumns = [
    { label: "Сервер",  render: nameCell },
    { label: "Кластер", render: clusterCell },
    { label: "IP",      render: ipCell },
    { label: "ОС",      render: osRawCell },
  ];

  const noVersionColumns = [
    { label: "Сервер",  render: nameCell },
    { label: "ОС (без версії)", render: osRawCell },
    { label: "Кластер", render: clusterCell },
    { label: "IP",      render: ipCell },
  ];

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="flex items-start justify-between mb-1 gap-4">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100">Дашборд безпеки</h1>
        <button
          onClick={() => exportToXlsx(data)}
          className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Вивантажити XLSX
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Зведений огляд ризиків: EOL сервери, не охоплені моніторингом, застарілі ОС
        {data.synced_at && (
          <span className="ml-2 text-gray-400">
            · оновлено {new Date(data.synced_at).toLocaleString("uk-UA")}
          </span>
        )}
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        <SummaryCard
          label="EOL серверів"
          count={data.eol_count}
          sub="підтримка закінчилась"
          colorClass={data.eol_count > 0 ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300" : "border-gray-200 bg-white text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}
        />
        <SummaryCard
          label="Закінчується"
          count={data.ending_soon_count}
          sub="підтримка ≤ 1 рік"
          colorClass={data.ending_soon_count > 0 ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300" : "border-gray-200 bg-white text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}
        />
        <SummaryCard
          label="VM без моніторингу"
          count={data.unmonitored_vm_count}
          sub="немає в Zabbix"
          colorClass={data.unmonitored_vm_count > 0 ? "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-300" : "border-gray-200 bg-white text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}
        />
        <SummaryCard
          label="Фіз. без моніторингу"
          count={data.unmonitored_phys_count}
          sub="немає в Zabbix"
          colorClass={data.unmonitored_phys_count > 0 ? "border-purple-300 bg-purple-50 text-purple-800 dark:border-purple-800 dark:bg-purple-900/20 dark:text-purple-300" : "border-gray-200 bg-white text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}
        />
        <SummaryCard
          label="ОС без версії"
          count={data.no_version_count}
          sub="Ubuntu/Linux, версія невідома"
          colorClass={data.no_version_count > 0 ? "border-yellow-300 bg-yellow-50 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300" : "border-gray-200 bg-white text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}
        />
        <SummaryCard
          label="ОС невідомо"
          count={data.unknown_os_count}
          sub="немає даних про ОС"
          colorClass={data.unknown_os_count > 0 ? "border-slate-400 bg-slate-100 text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300" : "border-gray-200 bg-white text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}
        />
      </div>

      {/* Risk score banner */}
      <div className={`rounded-xl px-5 py-4 mb-6 flex items-center gap-4 ${
        totalRisk === 0
          ? "bg-green-50 border border-green-200"
          : data.eol_count > 20 || data.unmonitored_vm_count > 100
            ? "bg-red-50 border border-red-200"
            : "bg-amber-50 border border-amber-200"
      }`}>
        <div className={`text-3xl font-bold ${
          totalRisk === 0 ? "text-green-700" : data.eol_count > 20 ? "text-red-700" : "text-amber-700"
        }`}>
          {totalRisk}
        </div>
        <div>
          <p className="font-semibold text-gray-800">
            {totalRisk === 0 ? "Критичних ризиків не виявлено" : "Загальна кількість ризиків"}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {data.eol_count} EOL · {data.ending_soon_count} закінчується · {data.unmonitored_vm_count + data.unmonitored_phys_count} без моніторингу · {data.no_version_count} ОС без версії
          </p>
        </div>
      </div>

      {/* Risk panels */}
      <RiskPanel
        title="EOL сервери — підтримка закінчилась"
        count={data.eol_count}
        accentClass="text-red-700"
        borderClass="border-red-200"
        headerBg="bg-red-50"
        items={data.eol_items}
        columns={eolColumns}
        emptyText="EOL серверів не виявлено"
      />

      <RiskPanel
        title="Підтримка незабаром закінчиться (≤ 1 рік)"
        count={data.ending_soon_count}
        accentClass="text-amber-700"
        borderClass="border-amber-200"
        headerBg="bg-amber-50"
        items={data.ending_soon_items}
        columns={eolColumns}
        emptyText="Серверів з підтримкою, що закінчується, не виявлено"
      />

      <RiskPanel
        title="VM не охоплені Zabbix-моніторингом"
        count={data.unmonitored_vm_count}
        accentClass="text-orange-700"
        borderClass="border-orange-200"
        headerBg="bg-orange-50"
        items={data.unmonitored_vms}
        columns={unmonitoredColumns}
        emptyText="Всі VM охоплені моніторингом"
      />

      <RiskPanel
        title="Фізичні сервери без Zabbix-моніторингу"
        count={data.unmonitored_phys_count}
        accentClass="text-purple-700"
        borderClass="border-purple-200"
        headerBg="bg-purple-50"
        items={data.unmonitored_phys}
        columns={unmonitoredColumns}
        emptyText="Всі фізичні сервери охоплені моніторингом"
      />

      <RiskPanel
        title="ОС визначено, але версія невідома"
        count={data.no_version_count}
        accentClass="text-yellow-700"
        borderClass="border-yellow-200"
        headerBg="bg-yellow-50"
        items={data.no_version_items}
        columns={noVersionColumns}
        emptyText="Всі VM мають вказану версію ОС"
      />

      <RiskPanel
        title="ОС невідомо — немає даних про операційну систему"
        count={data.unknown_os_count}
        accentClass="text-slate-700"
        borderClass="border-slate-300"
        headerBg="bg-slate-100"
        items={data.unknown_os_items}
        columns={unmonitoredColumns}
        emptyText="Всі VM мають ідентифіковану ОС"
      />
    </div>
  );
}
