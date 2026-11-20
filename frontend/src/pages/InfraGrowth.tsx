import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { api } from "../api/client";
import type { InfraGrowthPoint } from "../api/client";

const PERIODS = [30, 90, 180, 365] as const;

function formatDate(d: string) {
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg p-3 text-xs shadow-lg">
      <div className="font-semibold text-gray-700 dark:text-slate-200 mb-2">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex justify-between gap-4 mb-1">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-bold text-gray-900 dark:text-white">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

export default function InfraGrowth() {
  const [days, setDays] = useState(90);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["infra-growth", days],
    queryFn: () => api.infraGrowth(days),
  });

  const points: InfraGrowthPoint[] = data?.points ?? [];
  const chartData = points.map((p) => ({
    date: formatDate(p.date),
    "ВМ": p.vm_total,
    "Фіз. сервери": p.physical_total,
  }));

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Зростання інфраструктури</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            Динаміка кількості VM та фізичних серверів у CMDB
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {PERIODS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={
                "px-3 py-1.5 rounded-lg text-sm border transition " +
                (days === d
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-blue-400")
              }
            >
              {d === 365 ? "1 рік" : `${d} днів`}
            </button>
          ))}
        </div>
      </div>

      {/* Current totals */}
      {data && (
        <div className="flex gap-3 flex-wrap">
          {[
            { label: "Поточно VM", value: data.current_vms, color: "text-blue-600 dark:text-blue-400" },
            { label: "Поточно фіз. серверів", value: data.current_physical, color: "text-emerald-600 dark:text-emerald-400" },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 min-w-[160px]"
            >
              <div className={`text-2xl font-bold ${color}`}>{value.toLocaleString("uk-UA")}</div>
              <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      {isLoading && <div className="h-72 flex items-center justify-center text-gray-400">Завантаження...</div>}
      {isError && <div className="h-72 flex items-center justify-center text-red-500">Помилка завантаження.</div>}

      {!isLoading && !isError && chartData.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-4">
            Кількість CI за останні {days} днів
          </h2>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorVm" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorPhys" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.5} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                tickLine={false}
                axisLine={false}
                interval={Math.ceil(chartData.length / 16) - 1}
              />
              <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={40} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(100,116,139,0.07)" }} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              <Area
                type="monotone"
                dataKey="ВМ"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#colorVm)"
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Area
                type="monotone"
                dataKey="Фіз. сервери"
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#colorPhys)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {!isLoading && !isError && chartData.length === 0 && (
        <div className="h-48 flex items-center justify-center text-gray-400 dark:text-slate-500">
          Немає даних — запустіть синхронізацію CMDB для накопичення статистики
        </div>
      )}
    </div>
  );
}
