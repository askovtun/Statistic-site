import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import {
  ComposedChart, Line, CartesianGrid, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";

function formatTick(ts: unknown) {
  return new Date(Number(ts) * 1000).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" });
}

function formatTooltipLabel(ts: unknown) {
  return new Date(Number(ts) * 1000).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function CoverageBar({ pct, color }: { pct: number | null; color: string }) {
  if (pct == null) return <span className="text-gray-300 text-xs">—</span>;
  const bg = pct >= 90 ? "bg-green-500" : pct >= 70 ? "bg-amber-400" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2.5 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${bg}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={`text-sm font-semibold w-12 text-right ${color}`}>{pct.toFixed(1)}%</span>
    </div>
  );
}

function KpiCard({ label, value, sub, monitored, total, color }: {
  label: string; value: number | null; sub?: string;
  monitored?: number; total?: number; color: string;
}) {
  const urgent = value != null && value < 70;
  const warn = value != null && value < 90;
  const borderColor = urgent ? "border-red-500" : warn ? "border-amber-400" : "border-green-500";
  return (
    <div className={`bg-white dark:bg-slate-900 rounded-xl shadow-sm border-l-4 ${borderColor} p-5`}>
      <p className="text-sm text-gray-500 dark:text-slate-400">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${color}`}>
        {value != null ? `${value.toFixed(1)}%` : "—"}
      </p>
      {monitored != null && total != null && (
        <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">{monitored} з {total}</p>
      )}
      {sub && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function MonitoringCoverage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["monitoring-coverage"],
    queryFn: () => api.monitoringCoverage(45),
    staleTime: 5 * 60 * 1000,
  });

  // Build chart-friendly history: add unix timestamp from date string
  const chartPoints = (data?.history ?? []).map(p => ({
    ...p,
    ts: Math.floor(new Date(p.date).getTime() / 1000),
  }));

  const latestPoint = chartPoints[chartPoints.length - 1] ?? null;
  const firstPoint = chartPoints[0] ?? null;
  const vmTrend = latestPoint && firstPoint
    ? +(latestPoint.vm_pct - firstPoint.vm_pct).toFixed(1)
    : null;
  const physTrend = latestPoint && firstPoint
    ? +(latestPoint.phys_pct - firstPoint.phys_pct).toFixed(1)
    : null;

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 mb-1">Покриття моніторингом</h1>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-5">Частка VM та фізичних серверів з активним Zabbix-агентом</p>

      {isError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-red-700 dark:text-red-300 text-sm mb-6">
          Помилка завантаження даних
        </div>
      )}
      {isLoading && <p className="text-gray-400 dark:text-slate-500 animate-pulse text-sm mb-4">Завантаження...</p>}

      {data && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <KpiCard
              label="Покриття ВМ"
              value={data.current_vm_pct}
              monitored={data.vm_monitored}
              total={data.vm_total}
              color={data.current_vm_pct != null && data.current_vm_pct >= 90 ? "text-green-700 dark:text-green-300" : "text-amber-700 dark:text-amber-300"}
            />
            <KpiCard
              label="Покриття фіз. серверів"
              value={data.current_phys_pct}
              monitored={data.phys_monitored}
              total={data.phys_total}
              color={data.current_phys_pct != null && data.current_phys_pct >= 90 ? "text-green-700 dark:text-green-300" : "text-amber-700 dark:text-amber-300"}
            />
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border-l-4 border-blue-400 p-5">
              <p className="text-sm text-gray-500 dark:text-slate-400">Зміна покриття ВМ</p>
              <p className={`text-2xl font-bold mt-1 ${vmTrend == null ? "text-gray-400" : vmTrend > 0 ? "text-green-700 dark:text-green-300" : vmTrend < 0 ? "text-red-700 dark:text-red-300" : "text-gray-700 dark:text-slate-200"}`}>
                {vmTrend != null ? `${vmTrend > 0 ? "+" : ""}${vmTrend}%` : "—"}
              </p>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">за період спостереження</p>
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border-l-4 border-purple-400 p-5">
              <p className="text-sm text-gray-500 dark:text-slate-400">Зміна покриття фіз.</p>
              <p className={`text-2xl font-bold mt-1 ${physTrend == null ? "text-gray-400" : physTrend > 0 ? "text-green-700 dark:text-green-300" : physTrend < 0 ? "text-red-700 dark:text-red-300" : "text-gray-700 dark:text-slate-200"}`}>
                {physTrend != null ? `${physTrend > 0 ? "+" : ""}${physTrend}%` : "—"}
              </p>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">за період спостереження</p>
            </div>
          </div>

          {/* Coverage trend chart */}
          {chartPoints.length > 1 && (
            <section className="mb-8">
              <h2 className="text-sm font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-3">
                Тренд покриття за {chartPoints.length} днів
              </h2>
              <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm p-4">
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={chartPoints}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="ts" tickFormatter={formatTick} tick={{ fontSize: 10, fill: "#9ca3af" }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#9ca3af" }} unit="%" width={35} />
                    <Tooltip
                      labelFormatter={formatTooltipLabel}
                      formatter={(v: unknown, name?: unknown) => [
                        `${Number(v).toFixed(1)}%`,
                        name === "vm_pct" ? "ВМ" : "Фіз. сервери",
                      ] as [string, string]}
                      contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" }}
                    />
                    <Legend formatter={v => v === "vm_pct" ? "ВМ" : "Фіз. сервери"} wrapperStyle={{ fontSize: 12 }} />
                    <ReferenceLine y={90} stroke="#22c55e" strokeDasharray="4 2" strokeOpacity={0.6} />
                    <Line type="monotone" dataKey="vm_pct" stroke="#3b82f6" dot={false} strokeWidth={2.5} connectNulls={false} />
                    <Line type="monotone" dataKey="phys_pct" stroke="#a855f7" dot={false} strokeWidth={2.5} connectNulls={false} />
                  </ComposedChart>
                </ResponsiveContainer>
                <p className="text-xs text-gray-400 dark:text-slate-500 mt-1 text-right">
                  Зелена лінія = ціль 90%
                </p>
              </div>
            </section>
          )}

          {/* History table */}
          {data.history.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-3">
                Щоденна статистика
              </h2>
              <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800 text-xs text-gray-500 dark:text-slate-400 uppercase">
                      <tr>
                        <th className="px-4 py-2.5 text-left">Дата</th>
                        <th className="px-4 py-2.5 text-right">ВМ всього</th>
                        <th className="px-4 py-2.5 text-right">ВМ монітор.</th>
                        <th className="px-4 py-2.5 text-left w-48">Покриття ВМ</th>
                        <th className="px-4 py-2.5 text-right">Фіз. всього</th>
                        <th className="px-4 py-2.5 text-right">Фіз. монітор.</th>
                        <th className="px-4 py-2.5 text-left w-48">Покриття фіз.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                      {[...data.history].reverse().map(p => (
                        <tr key={p.date} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                          <td className="px-4 py-2 text-gray-700 dark:text-slate-200 font-mono text-xs">
                            {new Date(p.date).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" })}
                          </td>
                          <td className="px-4 py-2 text-right text-gray-600 dark:text-slate-300">{p.vm_total}</td>
                          <td className="px-4 py-2 text-right text-gray-600 dark:text-slate-300">{p.vm_monitored}</td>
                          <td className="px-4 py-2">
                            <CoverageBar pct={p.vm_pct} color={p.vm_pct >= 90 ? "text-green-700 dark:text-green-300" : "text-amber-700 dark:text-amber-300"} />
                          </td>
                          <td className="px-4 py-2 text-right text-gray-600 dark:text-slate-300">{p.phys_total}</td>
                          <td className="px-4 py-2 text-right text-gray-600 dark:text-slate-300">{p.phys_monitored}</td>
                          <td className="px-4 py-2">
                            <CoverageBar pct={p.phys_pct} color={p.phys_pct >= 90 ? "text-green-700 dark:text-green-300" : "text-amber-700 dark:text-amber-300"} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
