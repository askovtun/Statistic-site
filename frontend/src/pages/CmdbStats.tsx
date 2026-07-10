import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, type CmdbDayStats } from "../api/client";

const PERIOD_OPTIONS = [
  { label: "30 днів",  value: 30  },
  { label: "90 днів",  value: 90  },
  { label: "180 днів", value: 180 },
  { label: "365 днів", value: 365 },
];

const CI_TYPE_LABELS: Record<string, string> = {
  vm:       "ВМ",
  physical: "Фіз. сервери",
  cluster:  "Кластери",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("uk-UA", {
    day: "2-digit", month: "2-digit", year: "2-digit",
  });
}

function fmtDateFull(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("uk-UA", {
    day: "numeric", month: "long", year: "numeric",
  });
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; fill: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-700 mb-2">{label ? fmtDateFull(label) : ""}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 mb-0.5">
          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: p.fill }} />
          <span className="text-gray-600">{p.name}:</span>
          <span className="font-semibold text-gray-800">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function CmdbStats() {
  const [period, setPeriod]     = useState(90);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: ["cmdbStats", period],
    queryFn:  () => api.cmdbStats(period),
  });

  function toggleExpand(date: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  }

  if (isLoading) return (
    <div className="p-4 md:p-6 lg:p-8">
      <p className="text-gray-400 animate-pulse">Завантаження...</p>
    </div>
  );
  if (error) return (
    <div className="p-4 md:p-6 lg:p-8">
      <p className="text-red-500 text-sm">Помилка: {String(error)}</p>
    </div>
  );

  const days = data?.days ?? [];
  const currentTotals = data?.current_totals ?? {};

  // Total CIs across all tracked types
  const totalCurrent = Object.values(currentTotals).reduce((a, b) => a + b, 0);

  // Stats over the selected period
  const periodAdded   = days.reduce((s, d) => s + d.added,   0);
  const periodUpdated = days.reduce((s, d) => s + d.updated, 0);
  const periodRemoved = days.reduce((s, d) => s + d.removed, 0);

  // Chart data — oldest first, newest last
  const chartData = [...days].reverse().map((d) => ({
    date:    d.date,
    Додано:  d.added,
    Змінено: d.updated,
    Видалено: d.removed,
  }));

  // Filter to only days with any changes (for cleaner chart when period is long)
  const hasAnyChange = (d: CmdbDayStats) => d.added > 0 || d.updated > 0 || d.removed > 0;
  const activeDaysCount = days.filter(hasAnyChange).length;

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">Статистика CMDB</h1>
      <p className="text-sm text-gray-500 mb-5">
        Кількість доданих, змінених та видалених Configuration Items щодня
        {data?.synced_at && (
          <span className="ml-2 text-gray-400">
            · Оновлено: {new Date(data.synced_at).toLocaleString("uk-UA")}
          </span>
        )}
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <div className="col-span-2 sm:col-span-3 lg:col-span-3 grid grid-cols-3 gap-3">
          {(Object.entries(currentTotals) as [string, number][]).map(([type, count]) => (
            <div key={type} className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-2xl font-bold text-gray-800">{count}</p>
              <p className="text-xs text-gray-500 mt-0.5">{CI_TYPE_LABELS[type] ?? type}</p>
            </div>
          ))}
          {Object.keys(currentTotals).length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-2xl font-bold text-blue-700">{totalCurrent}</p>
              <p className="text-xs text-blue-600 mt-0.5">Всього CI</p>
            </div>
          )}
        </div>
        <div className="col-span-2 sm:col-span-3 lg:col-span-3 grid grid-cols-3 gap-3">
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <p className="text-2xl font-bold text-green-700">+{periodAdded}</p>
            <p className="text-xs text-green-600 mt-0.5">Додано</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-2xl font-bold text-blue-700">~{periodUpdated}</p>
            <p className="text-xs text-blue-600 mt-0.5">Змінено</p>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <p className="text-2xl font-bold text-red-700">-{periodRemoved}</p>
            <p className="text-xs text-red-600 mt-0.5">Видалено</p>
          </div>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm text-gray-500">Період:</span>
        {PERIOD_OPTIONS.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => setPeriod(value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
              period === value
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
            }`}
          >
            {label}
          </button>
        ))}
        {activeDaysCount > 0 && (
          <span className="ml-auto text-xs text-gray-400">
            {activeDaysCount} дн. зі змінами з {days.length}
          </span>
        )}
      </div>

      {/* Bar chart */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-600 mb-4">Зміни за днями</h2>
        {chartData.length === 0 ? (
          <p className="text-center py-12 text-gray-400 text-sm">Немає даних за цей період</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tickFormatter={fmtDate}
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                interval="preserveStartEnd"
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                width={32}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                iconType="square"
              />
              <Bar dataKey="Додано"  fill="#22c55e" radius={[2, 2, 0, 0]} maxBarSize={40} />
              <Bar dataKey="Змінено" fill="#3b82f6" radius={[2, 2, 0, 0]} maxBarSize={40} />
              <Bar dataKey="Видалено" fill="#ef4444" radius={[2, 2, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Daily table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-600">Деталі по днях</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 w-8" />
                <th className="px-4 py-3 text-left">Дата</th>
                <th className="px-4 py-3 text-right text-green-600">Додано</th>
                <th className="px-4 py-3 text-right text-blue-600">Змінено</th>
                <th className="px-4 py-3 text-right text-red-600">Видалено</th>
                <th className="px-4 py-3 text-right">Всього CI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {days.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-400">
                    Немає даних. Натисніть &quot;Оновити дані&quot; для першого синку.
                  </td>
                </tr>
              ) : (
                days.map((day) => {
                  const isOpen    = expanded.has(day.date);
                  const hasChange = hasAnyChange(day);
                  return (
                    <>
                      <tr
                        key={day.date}
                        onClick={() => day.breakdown.length > 0 && toggleExpand(day.date)}
                        className={`transition-colors ${
                          day.breakdown.length > 0 ? "cursor-pointer hover:bg-gray-50" : ""
                        } ${hasChange ? "" : "opacity-50"}`}
                      >
                        <td className="px-4 py-2.5 text-center">
                          {day.breakdown.length > 0 && (
                            <span className="text-gray-400 text-xs font-bold select-none">
                              {isOpen ? "▲" : "▼"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-gray-700">
                          {fmtDateFull(day.date)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {day.added > 0
                            ? <span className="font-semibold text-green-600">+{day.added}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {day.updated > 0
                            ? <span className="font-semibold text-blue-600">~{day.updated}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {day.removed > 0
                            ? <span className="font-semibold text-red-600">-{day.removed}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-600 font-medium">
                          {day.total}
                        </td>
                      </tr>

                      {/* Breakdown by CI type */}
                      {isOpen && day.breakdown.map((b) => (
                        <tr
                          key={`${day.date}-${b.ci_type}`}
                          className="bg-gray-50 border-l-4 border-blue-100 text-xs text-gray-500"
                        >
                          <td />
                          <td className="px-6 py-1.5 text-gray-500">
                            {CI_TYPE_LABELS[b.ci_type] ?? b.ci_type}
                          </td>
                          <td className="px-4 py-1.5 text-right">
                            {b.added > 0 ? <span className="text-green-600 font-medium">+{b.added}</span> : "—"}
                          </td>
                          <td className="px-4 py-1.5 text-right">
                            {b.updated > 0 ? <span className="text-blue-600 font-medium">~{b.updated}</span> : "—"}
                          </td>
                          <td className="px-4 py-1.5 text-right">
                            {b.removed > 0 ? <span className="text-red-600 font-medium">-{b.removed}</span> : "—"}
                          </td>
                          <td className="px-4 py-1.5 text-right text-gray-400">{b.total}</td>
                        </tr>
                      ))}
                    </>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
