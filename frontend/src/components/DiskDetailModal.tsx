import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const PERIODS = [7, 14, 30, 90] as const;

function formatTick(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" });
}
function formatLabel(ts: unknown) {
  return new Date(Number(ts) * 1000).toLocaleString("uk-UA");
}

function MiniChart({
  title,
  dataKey,
  color,
  unit = "%",
  data,
  domain,
}: {
  title: string;
  dataKey: string;
  color: string;
  unit?: string;
  data: Record<string, number | null>[];
  domain?: [number | string, number | string];
}) {
  const hasData = data.some((p) => p[dataKey] != null);
  return (
    <div className="bg-gray-50 dark:bg-slate-800/60 rounded-lg p-3">
      <p className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-2">{title}</p>
      {hasData ? (
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.5} />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={formatTick}
              tick={{ fontSize: 10 }}
              minTickGap={40}
            />
            <YAxis
              domain={domain ?? [0, 100]}
              tick={{ fontSize: 10 }}
              width={42}
              unit={unit}
              tickFormatter={(v) => (typeof v === "number" ? v.toFixed(0) : v)}
            />
            <Tooltip
              labelFormatter={formatLabel}
              formatter={(v: unknown) => [`${Number(v).toFixed(1)}${unit}`, title]}
            />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              dot={false}
              strokeWidth={2}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-40 flex items-center justify-center">
          <p className="text-sm text-gray-400 dark:text-slate-500">Немає даних</p>
        </div>
      )}
    </div>
  );
}

export default function DiskDetailModal({
  vmName,
  onClose,
}: {
  vmName: string;
  onClose: () => void;
}) {
  const [days, setDays] = useState<number>(30);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["resourceHistory", vmName, days],
    queryFn: () => api.resourceHistory(vmName, days),
    staleTime: 5 * 60_000,
  });

  const zabbixPoints = (data?.points ?? []) as unknown as Record<string, number | null>[];
  const vcenterPoints = (data?.vcenter_points ?? []) as unknown as Record<string, number | null>[];

  const hasIo = vcenterPoints.some((p) => p["disk_io_kbps"] != null);
  const hasVcDisk = vcenterPoints.some((p) => p["disk_used_pct"] != null);

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-bold">{vmName}</h2>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Дискова підсистема</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition"
          >
            ×
          </button>
        </div>

        {/* Period selector */}
        <div className="px-6 pt-4 flex gap-2">
          {PERIODS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={
                "px-3 py-1.5 rounded-lg text-xs font-medium border transition " +
                (days === d
                  ? "bg-blue-500 text-white border-blue-500"
                  : "border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400")
              }
            >
              {d} днів
            </button>
          ))}
        </div>

        <div className="p-6 space-y-4">
          {isLoading && (
            <p className="text-gray-400 dark:text-slate-500 animate-pulse text-sm">
              Завантаження...
            </p>
          )}
          {isError && (
            <p className="text-red-500 text-sm">Помилка завантаження даних</p>
          )}

          {data && (
            <>
              {/* Disk free % */}
              <MiniChart
                title="Диск — вільно % (Zabbix)"
                dataKey="disk_free_pct"
                color="#22c55e"
                unit="%"
                data={zabbixPoints}
                domain={[0, 100]}
              />

              {/* Disk used % from Zabbix */}
              <MiniChart
                title="Диск — використано % (Zabbix)"
                dataKey="disk_used_pct"
                color="#f59e0b"
                unit="%"
                data={zabbixPoints}
                domain={[0, 100]}
              />

              {/* Disk I/O from vCenter */}
              <MiniChart
                title={`Disk I/O — навантаження${hasIo ? "" : " (vCenter)"}`}
                dataKey="disk_io_kbps"
                color="#a855f7"
                unit=" КБ/с"
                data={vcenterPoints}
                domain={["auto", "auto"]}
              />

              {hasVcDisk && (
                <MiniChart
                  title="Диск — використано % (vCenter)"
                  dataKey="disk_used_pct"
                  color="#f97316"
                  unit="%"
                  data={vcenterPoints}
                  domain={[0, 100]}
                />
              )}

              {/* Latency section */}
              <div className="rounded-lg border border-dashed border-gray-300 dark:border-slate-700 px-4 py-3">
                <p className="text-sm font-semibold text-gray-600 dark:text-slate-300 mb-1">
                  Латенсь дискових операцій
                </p>
                <p className="text-xs text-gray-400 dark:text-slate-500 leading-relaxed">
                  Немає даних — для відображення read/write latency потрібен додатковий збір
                  метрик Zabbix:{" "}
                  <code className="bg-gray-100 dark:bg-slate-800 px-1 rounded text-[11px]">
                    vfs.dev.read.time
                  </code>
                  ,{" "}
                  <code className="bg-gray-100 dark:bg-slate-800 px-1 rounded text-[11px]">
                    vfs.dev.write.time
                  </code>
                  ,{" "}
                  <code className="bg-gray-100 dark:bg-slate-800 px-1 rounded text-[11px]">
                    vfs.dev.util
                  </code>
                  . Додайте ці items у Zabbix template — після наступної синхронізації вони
                  з'являться тут автоматично.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
