import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { api, type ResourceHistoryResponse } from "../api/client";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type AxisDomainItem,
} from "recharts";

const PERIOD_OPTIONS = [7, 14, 30, 90];

function formatTick(ts: number) {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" });
}

function formatTooltipLabel(ts: unknown) {
  return new Date(Number(ts) * 1000).toLocaleString("uk-UA");
}

function ChartCard<T extends { timestamp: number }>({
  title,
  dataKey,
  color,
  points,
  unit = "%",
  domain = [0, 100],
}: {
  title: string;
  dataKey: keyof T;
  color: string;
  points: T[];
  unit?: string;
  domain?: [AxisDomainItem, AxisDomainItem];
}) {
  const hasData = points.some((p) => p[dataKey] != null);
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-sm font-medium text-gray-600 mb-2">{title}</p>
      {hasData ? (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={points}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={formatTick}
              tick={{ fontSize: 11 }}
              minTickGap={40}
            />
            <YAxis domain={domain} tick={{ fontSize: 11 }} width={36} unit={unit} />
            <Tooltip
              labelFormatter={formatTooltipLabel}
              formatter={(v: unknown) => [`${Number(v).toFixed(1)}${unit}`, title]}
            />
            <Line
              type="monotone"
              dataKey={dataKey as string}
              stroke={color}
              dot={false}
              strokeWidth={1.5}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-center text-gray-400 text-sm py-16">Немає даних</p>
      )}
    </div>
  );
}

export default function ResourceHistoryModal({
  name,
  onClose,
  historyFn,
  showVCenter = true,
}: {
  name: string;
  onClose: () => void;
  historyFn?: (name: string, days: number) => Promise<ResourceHistoryResponse>;
  showVCenter?: boolean;
}) {
  const [days, setDays] = useState(7);
  const fetchFn = historyFn ?? api.resourceHistory;
  const { data, isLoading, error } = useQuery({
    queryKey: ["resourceHistory", name, days, historyFn ? "phys" : "vm"],
    queryFn: () => fetchFn(name, days),
  });

  const noData = data && data.points.length === 0 && (!showVCenter || data.vcenter_points.length === 0);

  return createPortal(
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">{name}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          {PERIOD_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 rounded-full text-sm border transition ${
                days === d
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
              }`}
            >
              {d} днів
            </button>
          ))}
        </div>

        {isLoading && <p className="text-gray-400 animate-pulse">Завантаження...</p>}
        {error && <p className="text-red-500 text-sm">Помилка: {String(error)}</p>}

        {noData && (
          <p className="text-gray-400 text-sm">Немає даних за обраний період</p>
        )}

        {data && !noData && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartCard title="CPU % (Zabbix)" dataKey="cpu_pct" color="#3b82f6" points={data.points} />
            {showVCenter && (
              <ChartCard title="CPU % (vCenter)" dataKey="vc_cpu_pct" color="#3b82f6" points={data.vcenter_points} />
            )}
            <ChartCard title="RAM % (Zabbix)" dataKey="ram_pct" color="#22c55e" points={data.points} />
            {showVCenter && (
              <ChartCard title="RAM % (vCenter)" dataKey="vc_ram_pct" color="#22c55e" points={data.vcenter_points} />
            )}
            <ChartCard
              title="Диск — використано % (Zabbix)"
              dataKey="disk_used_pct"
              color="#f59e0b"
              points={data.points}
            />
            {showVCenter && (
              <>
                <ChartCard
                  title="Диск — використано % (vCenter)"
                  dataKey="disk_used_pct"
                  color="#f59e0b"
                  points={data.vcenter_points}
                />
                <ChartCard
                  title="Disk I/O (vCenter)"
                  dataKey="disk_io_kbps"
                  color="#a855f7"
                  points={data.vcenter_points}
                  unit=" КБ/с"
                  domain={["auto", "auto"]}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
