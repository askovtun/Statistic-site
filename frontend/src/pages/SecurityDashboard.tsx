import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type SecurityServerItem } from "../api/client";
import Pagination from "../components/Pagination";

const PAGE = 50;

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
  const [open, setOpen]   = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage]   = useState(1);

  const filtered = search
    ? items.filter((i) => {
        const q = search.toLowerCase();
        return (
          i.name.toLowerCase().includes(q) ||
          (i.cluster ?? "").toLowerCase().includes(q) ||
          (i.fqdn ?? "").toLowerCase().includes(q) ||
          (i.primary_ip ?? "").includes(q) ||
          (i.os_product ?? "").toLowerCase().includes(q)
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
        <div className="bg-white">
          {count === 0 ? (
            <p className="px-5 py-6 text-center text-gray-400 text-sm">{emptyText}</p>
          ) : (
            <>
              <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-3">
                <input
                  type="text"
                  placeholder="Пошук..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="w-full max-w-sm px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:border-blue-400"
                />
                <span className="text-xs text-gray-400 shrink-0">{filtered.length} з {count}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>
                      {columns.map((c) => (
                        <th key={c.label} className="px-4 py-2 text-left whitespace-nowrap">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pageItems.map((item) => (
                      <tr key={`${item.ci_type}-${item.name}`} className="hover:bg-gray-50 transition-colors">
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
      <div className="font-medium text-gray-800 whitespace-nowrap">{i.name}</div>
      {i.fqdn && <div className="text-xs text-gray-400">{i.fqdn}</div>}
    </div>
  );
}

function osCell(i: SecurityServerItem) {
  if (!i.os_product && !i.os_raw) return <span className="text-gray-300 text-xs">—</span>;
  return <span className="text-xs text-gray-700">{i.os_product ?? i.os_raw}</span>;
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
  return <span className="text-xs text-gray-500">{i.cluster ?? "—"}</span>;
}

function ipCell(i: SecurityServerItem) {
  return <span className="text-xs text-gray-500">{i.primary_ip ?? "—"}</span>;
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

  const totalRisk = data.eol_count + data.ending_soon_count + data.unmonitored_vm_count + data.unmonitored_phys_count;

  const eolColumns = [
    { label: "Сервер",           render: nameCell },
    { label: "Операційна система", render: osCell },
    { label: "Дата EOL / Днів",  render: eolCell },
    { label: "Кластер",          render: clusterCell },
    { label: "IP",               render: ipCell },
  ];

  const unmonitoredColumns = [
    { label: "Сервер",  render: nameCell },
    { label: "Кластер", render: clusterCell },
    { label: "IP",      render: ipCell },
    { label: "ОС",      render: (i: SecurityServerItem) =>
      <span className="text-xs text-gray-400">{i.os_raw ?? "—"}</span> },
  ];

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">Дашборд безпеки</h1>
      <p className="text-sm text-gray-500 mb-6">
        Зведений огляд ризиків: EOL сервери, не охоплені моніторингом, застарілі ОС
        {data.synced_at && (
          <span className="ml-2 text-gray-400">
            · оновлено {new Date(data.synced_at).toLocaleString("uk-UA")}
          </span>
        )}
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <SummaryCard
          label="EOL серверів"
          count={data.eol_count}
          sub="підтримка закінчилась"
          colorClass={data.eol_count > 0 ? "border-red-300 bg-red-50 text-red-800" : "border-gray-200 bg-white text-gray-700"}
        />
        <SummaryCard
          label="Закінчується"
          count={data.ending_soon_count}
          sub="підтримка ≤ 1 рік"
          colorClass={data.ending_soon_count > 0 ? "border-amber-300 bg-amber-50 text-amber-800" : "border-gray-200 bg-white text-gray-700"}
        />
        <SummaryCard
          label="VM без моніторингу"
          count={data.unmonitored_vm_count}
          sub="немає в Zabbix"
          colorClass={data.unmonitored_vm_count > 0 ? "border-orange-300 bg-orange-50 text-orange-800" : "border-gray-200 bg-white text-gray-700"}
        />
        <SummaryCard
          label="Фіз. без моніторингу"
          count={data.unmonitored_phys_count}
          sub="немає в Zabbix"
          colorClass={data.unmonitored_phys_count > 0 ? "border-purple-300 bg-purple-50 text-purple-800" : "border-gray-200 bg-white text-gray-700"}
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
            {data.eol_count} EOL · {data.ending_soon_count} закінчується · {data.unmonitored_vm_count + data.unmonitored_phys_count} без моніторингу
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
    </div>
  );
}
