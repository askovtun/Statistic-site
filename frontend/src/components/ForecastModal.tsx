import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import {
  CartesianGrid,
  Line,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const PERIOD_OPTIONS = [
  { label: "30 днів", value: 30 },
  { label: "90 днів", value: 90 },
];

function formatTick(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" });
}

function formatTooltipLabel(ts: unknown) {
  return new Date(Number(ts) * 1000).toLocaleDateString("uk-UA", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function daysLabel(days: number | null | undefined): string {
  if (days == null) return "—";
  if (days === 0) return "вже досягнуто";
  return `~${days} днів`;
}

export default function ForecastModal({
  clusterName,
  onClose,
}: {
  clusterName: string;
  onClose: () => void;
}) {
  const [periodDays, setPeriodDays] = useState(90);

  const { data, isLoading, error } = useQuery({
    queryKey: ["clusterForecast", clusterName, periodDays],
    queryFn: () => api.clusterForecast(clusterName, periodDays),
  });

  const points = data?.points ?? [];
  const hasData = points.some((p) => p.avg_cpu_pct != null || p.avg_ram_pct != null);

  // Compute projected points: extend trend line 30 more days
  const projected = (() => {
    if (points.length < 5) return [];
    const last = points[points.length - 1];
    const cpuVals = points.map((p, i) => [i, p.avg_cpu_pct] as [number, number | null]).filter((v) => v[1] != null);
    const ramVals = points.map((p, i) => [i, p.avg_ram_pct] as [number, number | null]).filter((v) => v[1] != null);

    function slope(vals: [number, number | null][]) {
      const clean = vals as [number, number][];
      if (clean.length < 3) return 0;
      const n = clean.length;
      const xm = clean.reduce((s, v) => s + v[0], 0) / n;
      const ym = clean.reduce((s, v) => s + v[1], 0) / n;
      const num = clean.reduce((s, v) => s + (v[0] - xm) * (v[1] - ym), 0);
      const den = clean.reduce((s, v) => s + (v[0] - xm) ** 2, 0);
      return den === 0 ? 0 : num / den;
    }

    const cpuSlope = slope(cpuVals);
    const ramSlope = slope(ramVals);
    const cpuLast = cpuVals.at(-1)?.[1] ?? null;
    const ramLast = ramVals.at(-1)?.[1] ?? null;
    const lastTs = last.timestamp;

    return Array.from({ length: 30 }, (_, i) => ({
      timestamp: lastTs + (i + 1) * 86400,
      proj_cpu: cpuLast != null ? Math.min(100, cpuLast + cpuSlope * (i + 1)) : null,
      proj_ram: ramLast != null ? Math.min(100, ramLast + ramSlope * (i + 1)) : null,
    }));
  })();

  const chartData = [
    ...points.map((p) => ({ ...p, proj_cpu: null, proj_ram: null })),
    ...projected.map((p) => ({ ...p, avg_cpu_pct: null, avg_ram_pct: null })),
  ];

  return createPortal(
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-800">Прогноз навантаження</h2>
            <p className="text-sm text-gray-500">{clusterName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="flex gap-2 mb-4">
          {PERIOD_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setPeriodDays(o.value)}
              className={`px-3 py-1 rounded-full text-sm border transition ${
                periodDays === o.value
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* Summary cards */}
        {data && (
          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="bg-blue-50 rounded-lg p-3">
              <p className="text-xs text-blue-600 font-medium">CPU → 80%</p>
              <p className="text-xl font-bold text-blue-800">{daysLabel(data.cpu_days_to_80)}</p>
              <p className="text-xs text-blue-400">при поточному тренді</p>
            </div>
            <div className="bg-purple-50 rounded-lg p-3">
              <p className="text-xs text-purple-600 font-medium">RAM → 80%</p>
              <p className="text-xl font-bold text-purple-800">{daysLabel(data.ram_days_to_80)}</p>
              <p className="text-xs text-purple-400">при поточному тренді</p>
            </div>
          </div>
        )}

        {isLoading && <p className="text-gray-400 animate-pulse">Завантаження...</p>}
        {error && <p className="text-red-500 text-sm">Помилка: {String(error)}</p>}
        {!isLoading && !hasData && (
          <p className="text-gray-400 text-sm">Немає vCenter даних для цього кластера</p>
        )}

        {hasData && (
          <div className="space-y-5">
            {/* CPU Chart */}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                CPU % (середнє по кластеру)
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="timestamp" tickFormatter={formatTick} tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip labelFormatter={formatTooltipLabel} formatter={(v: unknown) => [`${Number(v).toFixed(1)}%`, ""]} />
                  <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="4 2" label={{ value: "80%", position: "right", fontSize: 11, fill: "#ef4444" }} />
                  <Line type="monotone" dataKey="avg_cpu_pct" name="CPU" stroke="#3b82f6" dot={false} strokeWidth={2} connectNulls={false} />
                  <Line type="monotone" dataKey="proj_cpu" name="Прогноз" stroke="#3b82f6" dot={false} strokeWidth={1.5} strokeDasharray="5 3" connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* RAM Chart */}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                RAM % (середнє по кластеру)
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="timestamp" tickFormatter={formatTick} tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip labelFormatter={formatTooltipLabel} formatter={(v: unknown) => [`${Number(v).toFixed(1)}%`, ""]} />
                  <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="4 2" label={{ value: "80%", position: "right", fontSize: 11, fill: "#ef4444" }} />
                  <Line type="monotone" dataKey="avg_ram_pct" name="RAM" stroke="#a855f7" dot={false} strokeWidth={2} connectNulls={false} />
                  <Line type="monotone" dataKey="proj_ram" name="Прогноз" stroke="#a855f7" dot={false} strokeWidth={1.5} strokeDasharray="5 3" connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <p className="text-xs text-gray-400">
              Суцільна лінія — реальні дані. Пунктир — лінійний прогноз на 30 днів. Червона лінія — поріг 80%.
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
