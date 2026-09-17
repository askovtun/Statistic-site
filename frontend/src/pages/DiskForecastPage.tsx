import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type DiskForecastItem } from "../api/client";
import { exportToXlsx } from "../utils/exportXlsx";

const PAGE = 50;

function urgencyClass(days: number | null): string {
  if (days === null) return "text-gray-400";
  if (days <= 7)  return "text-red-700 dark:text-red-300 font-bold";
  if (days <= 30) return "text-red-600 dark:text-red-400 font-semibold";
  if (days <= 90) return "text-amber-600 dark:text-amber-400";
  return "text-green-600 dark:text-green-400";
}

function TrendBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-gray-300 dark:text-slate-600 text-xs">—</span>;
  const used = 100 - pct;
  const color = pct < 10 ? "bg-red-500" : pct < 20 ? "bg-amber-500" : pct < 50 ? "bg-yellow-400" : "bg-green-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 max-w-[80px] bg-gray-100 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.min(100, used)}%` }} />
      </div>
      <span className={`text-xs tabular-nums ${pct < 20 ? "text-red-600 dark:text-red-400 font-semibold" : "text-gray-600 dark:text-slate-300"}`}>
        {pct.toFixed(1)}% вільно
      </span>
    </div>
  );
}

export default function DiskForecastPage() {
  const [periodDays, setPeriodDays] = useState(30);
  const [warnDays, setWarnDays]     = useState(90);
  const [search, setSearch]         = useState("");
  const [page, setPage]             = useState(1);
  const [showOnlyFilling, setShowOnlyFilling] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["diskForecast", periodDays, warnDays],
    queryFn: () => api.diskForecast(periodDays, warnDays),
    staleTime: 5 * 60 * 1000,
  });

  const filtered = (data?.items ?? []).filter((i) => {
    if (showOnlyFilling && i.days_until_full === null) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      i.name.toLowerCase().includes(q) ||
      (i.cluster ?? "").toLowerCase().includes(q) ||
      (i.fqdn ?? "").toLowerCase().includes(q) ||
      (i.primary_ip ?? "").includes(q)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageItems  = filtered.slice((page - 1) * PAGE, page * PAGE);

  function handleExport() {
    exportToXlsx(
      `disk-forecast-${periodDays}d.xlsx`,
      "Disk Forecast",
      (data?.items ?? []).map((i) => ({
        "Назва ВМ":       i.name,
        "Кластер":        i.cluster ?? "",
        "FQDN":           i.fqdn ?? "",
        "IP":             i.primary_ip ?? "",
        "Вільно %":       i.current_free_pct ?? "",
        "Мін. вільно %":  i.min_free_pct ?? "",
        "Днів до заповнення": i.days_until_full ?? "стабільно",
        "Тренд %/день":   i.trend_pct_per_day ?? "",
        "Точок даних":    i.data_points,
      })),
    );
  }

  if (isLoading) return (
    <div className="p-8 space-y-4 animate-pulse">
      <div className="h-8 w-64 bg-gray-200 dark:bg-slate-700 rounded" />
      <div className="grid grid-cols-3 gap-4">
        {[0,1,2].map(i => <div key={i} className="h-20 bg-gray-200 dark:bg-slate-700 rounded-xl" />)}
      </div>
      <div className="h-64 bg-gray-100 dark:bg-slate-800 rounded-xl" />
    </div>
  );

  if (error) return <div className="p-8 text-red-500 text-sm">Помилка: {String(error)}</div>;

  return (
    <div className="p-4 md:p-6 lg:p-8 print:p-2">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100">Прогноз місця на дисках</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            Лінійна регресія disk_free_pct — коли диски заповняться
            {data?.synced_at && (
              <span className="ml-2 text-gray-400">· оновлено {new Date(data.synced_at).toLocaleString("uk-UA")}</span>
            )}
          </p>
        </div>
        <button
          onClick={handleExport}
          className="print:hidden px-3 py-1.5 rounded-lg border border-gray-300 dark:border-slate-600 text-sm text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition"
        >
          Експорт XLSX ↓
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="rounded-xl border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
          <p className="text-2xl font-bold text-red-700 dark:text-red-300">{data?.critical ?? 0}</p>
          <p className="text-sm font-medium text-red-700 dark:text-red-400 mt-0.5">Критично</p>
          <p className="text-xs text-red-500 dark:text-red-500 opacity-70">заповняться ≤ 30 днів</p>
        </div>
        <div className={`rounded-xl border-2 p-4 ${(data?.warning ?? 0) > 0 ? "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20" : "border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900"}`}>
          <p className={`text-2xl font-bold ${(data?.warning ?? 0) > 0 ? "text-amber-700 dark:text-amber-300" : "text-gray-700 dark:text-slate-200"}`}>
            {data?.warning ?? 0}
          </p>
          <p className={`text-sm font-medium mt-0.5 ${(data?.warning ?? 0) > 0 ? "text-amber-700 dark:text-amber-400" : "text-gray-500 dark:text-slate-400"}`}>
            Попередження
          </p>
          <p className="text-xs opacity-70">заповняться ≤ {warnDays} днів</p>
        </div>
        <div className="rounded-xl border-2 border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <p className="text-2xl font-bold text-gray-700 dark:text-slate-200">{data?.total ?? 0}</p>
          <p className="text-sm font-medium text-gray-500 dark:text-slate-400 mt-0.5">ВМ у звіті</p>
          <p className="text-xs text-gray-400 opacity-70">із відстежуваним диском</p>
        </div>
        <div className="rounded-xl border-2 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4">
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{periodDays}d</p>
          <p className="text-sm font-medium text-blue-600 dark:text-blue-400 mt-0.5">Вікно аналізу</p>
          <p className="text-xs text-blue-500 opacity-70">денні точки даних</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4 print:hidden">
        <label className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-2">
          Аналіз:
          <select
            value={periodDays}
            onChange={(e) => { setPeriodDays(+e.target.value); setPage(1); }}
            className="text-xs border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200"
          >
            <option value={7}>7 днів</option>
            <option value={14}>14 днів</option>
            <option value={30}>30 днів</option>
            <option value={60}>60 днів</option>
            <option value={90}>90 днів</option>
          </select>
        </label>
        <label className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-2">
          Поріг:
          <select
            value={warnDays}
            onChange={(e) => { setWarnDays(+e.target.value); setPage(1); }}
            className="text-xs border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200"
          >
            <option value={30}>30 днів</option>
            <option value={60}>60 днів</option>
            <option value={90}>90 днів</option>
            <option value={180}>180 днів</option>
          </select>
        </label>
        <label className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showOnlyFilling}
            onChange={(e) => { setShowOnlyFilling(e.target.checked); setPage(1); }}
            className="rounded"
          />
          Тільки ті що заповнюються
        </label>
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Пошук ВМ / IP / кластер..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg text-xs bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200 focus:outline-none focus:border-blue-400"
          />
        </div>
        <span className="text-xs text-gray-400 dark:text-slate-500 shrink-0">{filtered.length} ВМ</span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-12 text-center">
          <p className="text-gray-400 dark:text-slate-500 text-sm">
            {(data?.total ?? 0) === 0
              ? "Немає даних про диски в Zabbix. Перевірте що metrics збираються (vfs.fs.size або system.disk.space)."
              : "Всі диски в нормі або даних не знайдено за фільтром."}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-slate-400 text-xs uppercase">
                <tr>
                  <th className="px-4 py-2.5 text-left">ВМ</th>
                  <th className="px-4 py-2.5 text-left">Кластер</th>
                  <th className="px-4 py-2.5 text-left">IP</th>
                  <th className="px-4 py-2.5 text-left whitespace-nowrap">Вільно (зараз)</th>
                  <th className="px-4 py-2.5 text-right whitespace-nowrap">Мін. вільно</th>
                  <th className="px-4 py-2.5 text-right whitespace-nowrap">Тренд %/день</th>
                  <th className="px-4 py-2.5 text-right whitespace-nowrap">Днів до заповнення</th>
                  <th className="px-4 py-2.5 text-right">Точок</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {pageItems.map((item: DiskForecastItem) => (
                  <tr key={item.name} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-4 py-2">
                      <div className="font-medium text-gray-800 dark:text-slate-100 whitespace-nowrap">{item.name}</div>
                      {item.fqdn && <div className="text-xs text-gray-400 dark:text-slate-500">{item.fqdn}</div>}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500 dark:text-slate-400">{item.cluster ?? "—"}</td>
                    <td className="px-4 py-2 text-xs text-gray-500 dark:text-slate-400 tabular-nums">{item.primary_ip ?? "—"}</td>
                    <td className="px-4 py-2 min-w-[160px]"><TrendBar pct={item.current_free_pct} /></td>
                    <td className="px-4 py-2 text-right text-xs tabular-nums">
                      {item.min_free_pct !== null
                        ? <span className={item.min_free_pct < 10 ? "text-red-600 dark:text-red-400 font-bold" : "text-gray-600 dark:text-slate-300"}>
                            {item.min_free_pct.toFixed(1)}%
                          </span>
                        : <span className="text-gray-300 dark:text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right text-xs tabular-nums">
                      {item.trend_pct_per_day !== null ? (
                        <span className={item.trend_pct_per_day < 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
                          {item.trend_pct_per_day > 0 ? "+" : ""}{item.trend_pct_per_day.toFixed(3)}
                        </span>
                      ) : <span className="text-gray-300 dark:text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {item.days_until_full !== null ? (
                        <span className={`text-sm font-semibold tabular-nums ${urgencyClass(item.days_until_full)}`}>
                          {item.days_until_full === 0 ? "вже повний" : `~${item.days_until_full} дн.`}
                        </span>
                      ) : (
                        <span className="text-xs text-green-600 dark:text-green-400">стабільно</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-gray-400 dark:text-slate-500 tabular-nums">{item.data_points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > PAGE && (
            <div className="px-4 py-3 border-t border-gray-100 dark:border-slate-800 flex items-center justify-between text-xs text-gray-400 dark:text-slate-500">
              <span>{(page - 1) * PAGE + 1}–{Math.min(page * PAGE, filtered.length)} з {filtered.length}</span>
              <div className="flex gap-1">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-2 py-1 rounded border border-gray-200 dark:border-slate-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-800">←</button>
                <span className="px-2 py-1">{page}/{totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="px-2 py-1 rounded border border-gray-200 dark:border-slate-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-800">→</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
