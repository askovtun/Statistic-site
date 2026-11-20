import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { api } from "../api/client";
import type { ZabbixTrendWeek } from "../api/client";

const PERIODS = [4, 8, 12, 24, 52] as const;

const SEV_CONFIG = [
  { key: "disaster",    label: "Катастрофа", color: "#dc2626" },
  { key: "high",        label: "Висока",     color: "#ea580c" },
  { key: "average",     label: "Середня",    color: "#d97706" },
  { key: "warning",     label: "Попередж.",  color: "#65a30d" },
  { key: "information", label: "Інформація", color: "#0891b2" },
] as const;

function SummaryCard({
  label, value, color,
}: { label: string; value: number; color: string }) {
  return (
    <div
      className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 flex flex-col gap-1"
      style={{ borderLeftWidth: 4, borderLeftColor: color }}
    >
      <div className="text-2xl font-bold text-gray-900 dark:text-white">
        {value.toLocaleString("uk-UA")}
      </div>
      <div className="text-xs text-gray-500 dark:text-slate-400">{label}</div>
    </div>
  );
}

function weekLabel(w: ZabbixTrendWeek): string {
  const d = new Date(w.week_start * 1000);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, p: any) => s + (p.value || 0), 0);
  return (
    <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg p-3 text-xs shadow-lg min-w-[160px]">
      <div className="font-semibold text-gray-700 dark:text-slate-200 mb-2">{label}</div>
      {payload
        .filter((p: any) => p.value > 0)
        .reverse()
        .map((p: any) => (
          <div key={p.name} className="flex justify-between gap-4 mb-1">
            <span style={{ color: p.color }}>{p.name}</span>
            <span className="font-medium text-gray-900 dark:text-white">{p.value}</span>
          </div>
        ))}
      <div className="border-t border-gray-100 dark:border-slate-700 mt-2 pt-1 flex justify-between font-semibold">
        <span className="text-gray-600 dark:text-slate-300">Всього</span>
        <span className="text-gray-900 dark:text-white">{total}</span>
      </div>
    </div>
  );
};

export default function ZabbixTrends() {
  const [weeks, setWeeks] = useState(12);
  const [stackMode, setStackMode] = useState<"stacked" | "grouped">("stacked");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["zabbix-trends", weeks],
    queryFn: () => api.zabbixTrends(weeks),
  });

  const chartData = (data?.weeks ?? []).map((w) => ({
    name: weekLabel(w),
    Катастрофа: w.disaster,
    Висока:     w.high,
    Середня:    w.average,
    "Попередж.": w.warning,
    Інформація: w.information,
  }));

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Тренди Zabbix</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            Тижнева динаміка інцидентів за severity — бачимо чи зростають проблеми
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {PERIODS.map((w) => (
            <button
              key={w}
              onClick={() => setWeeks(w)}
              className={
                "px-3 py-1.5 rounded-lg text-sm border transition " +
                (weeks === w
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-blue-400")
              }
            >
              {w === 52 ? "1 рік" : `${w} тиж`}
            </button>
          ))}
          <button
            onClick={() => setStackMode((m) => (m === "stacked" ? "grouped" : "stacked"))}
            className="px-3 py-1.5 rounded-lg text-sm border bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-blue-400 transition"
          >
            {stackMode === "stacked" ? "Групований" : "Стекований"}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {SEV_CONFIG.map(({ key, label, color }) => (
            <SummaryCard
              key={key}
              label={label}
              value={(data as any)[key] as number}
              color={color}
            />
          ))}
        </div>
      )}

      {/* Total badge */}
      {data && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400">
          <span>Всього за {weeks} тижнів:</span>
          <span className="font-bold text-gray-900 dark:text-white">
            {data.total_problems.toLocaleString("uk-UA")} інцидентів
          </span>
        </div>
      )}

      {isLoading && (
        <div className="h-72 flex items-center justify-center text-gray-400">
          Завантаження...
        </div>
      )}
      {isError && (
        <div className="h-72 flex items-center justify-center text-red-500">
          Помилка завантаження даних Zabbix.
        </div>
      )}

      {/* Bar chart */}
      {!isLoading && !isError && chartData.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-4">
            Кількість інцидентів по тижнях
          </h2>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
              barCategoryGap={stackMode === "stacked" ? "20%" : "10%"}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.5} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                tickLine={false}
                axisLine={false}
                interval={Math.ceil(chartData.length / 16) - 1}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(100,116,139,0.07)" }} />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                formatter={(v) => (
                  <span className="text-gray-600 dark:text-slate-300">{v}</span>
                )}
              />
              {SEV_CONFIG.map(({ label, color }) => (
                <Bar
                  key={label}
                  dataKey={label}
                  fill={color}
                  stackId={stackMode === "stacked" ? "a" : undefined}
                  radius={stackMode === "grouped" ? [3, 3, 0, 0] : undefined}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {!isLoading && !isError && chartData.length === 0 && (
        <div className="h-48 flex items-center justify-center text-gray-400 dark:text-slate-500">
          Немає даних за обраний період
        </div>
      )}

      {/* Weekly table */}
      {data && data.weeks.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Тиждень</th>
                {SEV_CONFIG.map(({ label, color }) => (
                  <th key={label} className="px-4 py-3 text-right font-semibold" style={{ color }}>
                    {label}
                  </th>
                ))}
                <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-slate-300">Всього</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800 bg-white dark:bg-slate-950">
              {[...data.weeks].reverse().map((w) => (
                <tr key={w.week_key} className="hover:bg-gray-50 dark:hover:bg-slate-900/60 transition-colors">
                  <td className="px-4 py-2 font-mono text-xs text-gray-700 dark:text-slate-300">{w.week_key}</td>
                  <td className="px-4 py-2 text-right text-xs">
                    {w.disaster > 0 ? (
                      <span className="font-bold text-red-600 dark:text-red-400">{w.disaster}</span>
                    ) : (
                      <span className="text-gray-300 dark:text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-xs">
                    {w.high > 0 ? (
                      <span className="font-semibold text-orange-600 dark:text-orange-400">{w.high}</span>
                    ) : (
                      <span className="text-gray-300 dark:text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-amber-600 dark:text-amber-400">
                    {w.average || <span className="text-gray-300 dark:text-slate-600">—</span>}
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-lime-600 dark:text-lime-400">
                    {w.warning || <span className="text-gray-300 dark:text-slate-600">—</span>}
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-cyan-600 dark:text-cyan-400">
                    {w.information || <span className="text-gray-300 dark:text-slate-600">—</span>}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold text-gray-800 dark:text-slate-200 text-xs">
                    {w.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
