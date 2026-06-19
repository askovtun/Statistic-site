import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, type ResourceItem } from "../api/client";

function StatCard({
  title,
  value,
  sub,
  color,
}: {
  title: string;
  value: number | string;
  sub?: string;
  color: string;
}) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border-l-4 ${color} p-5`}>
      <p className="text-sm text-gray-500">{title}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function TopBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
      <div
        className={`h-2 rounded-full ${color}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

function TopList({
  title,
  items,
  color,
}: {
  title: string;
  items: { name: string; pct: number }[];
  color: string;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-5">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{title}</p>
      <div className="space-y-2.5">
        {items.length === 0 && <p className="text-xs text-gray-400">Немає даних</p>}
        {items.map((item, i) => (
          <div key={item.name} className="flex items-center gap-2">
            <span className="text-xs text-gray-400 w-4 text-right">{i + 1}</span>
            <span className="text-xs text-gray-700 w-40 truncate" title={item.name}>{item.name}</span>
            <TopBar pct={item.pct} color={color} />
            <span className="text-xs font-medium text-gray-600 w-10 text-right">
              {item.pct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function avg(vals: (number | null | undefined)[]): number | null {
  const clean = vals.filter((v): v is number => v != null);
  if (!clean.length) return null;
  return clean.reduce((s, v) => s + v, 0) / clean.length;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const comp = useQuery({ queryKey: ["comparison"], queryFn: api.comparison });
  const res = useQuery({ queryKey: ["resources"], queryFn: () => api.resources() });
  const cl = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const phys = useQuery({ queryKey: ["physical-servers", 30], queryFn: () => api.physicalServers(30) });

  const loading = comp.isLoading || res.isLoading || cl.isLoading;

  // Top-5 consumers — computed from existing resources data
  const topConsumers = useMemo(() => {
    const items: ResourceItem[] = res.data?.items ?? [];
    const top = (key: (i: ResourceItem) => number | null, n = 5) =>
      [...items]
        .filter((i) => key(i) != null)
        .sort((a, b) => (key(b) ?? 0) - (key(a) ?? 0))
        .slice(0, n)
        .map((i) => ({ name: i.name, pct: key(i)! }));

    return {
      cpu: top((i) => i.avg_cpu_pct),
      ram: top((i) => i.avg_ram_pct),
      disk: top((i) => i.avg_disk_used_pct),
    };
  }, [res.data]);

  // Overall averages
  const overallAvg = useMemo(() => {
    const items: ResourceItem[] = res.data?.items ?? [];
    return {
      cpu: avg(items.map((i) => i.avg_cpu_pct)),
      ram: avg(items.map((i) => i.avg_ram_pct)),
    };
  }, [res.data]);

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">Дашборд</h1>
      <p className="text-sm text-gray-500 mb-8">Загальний стан інфраструктури</p>

      {loading && (
        <p className="text-gray-400 text-sm animate-pulse">Завантаження даних...</p>
      )}

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          CMDB vs Моніторинг
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            title="Всього ВМ"
            value={comp.data?.total ?? "—"}
            color="border-blue-500"
          />
          <StatCard
            title="В моніторингу"
            value={comp.data?.monitored ?? "—"}
            sub={comp.data ? `${((comp.data.monitored / comp.data.total) * 100).toFixed(0)}%` : ""}
            color="border-green-500"
          />
          <StatCard
            title="Не моніторяться"
            value={comp.data?.cmdb_only ?? "—"}
            sub="Є в CMDB, немає в Zabbix"
            color="border-yellow-500"
          />
          <StatCard
            title="Тіньові сервери"
            value={comp.data?.zabbix_only ?? "—"}
            sub="Є в Zabbix, немає в CMDB"
            color="border-red-500"
          />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Аналіз ресурсів ВМ
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <StatCard
            title="Оптимальні"
            value={res.data?.optimal ?? "—"}
            color="border-green-500"
          />
          <StatCard
            title="Oversized"
            value={res.data?.oversized ?? "—"}
            sub="Ресурсів більше ніж потрібно"
            color="border-blue-400"
          />
          <StatCard
            title="Undersized"
            value={res.data?.undersized ?? "—"}
            sub="Потребують більше ресурсів"
            color="border-red-400"
          />
          <StatCard
            title="Без даних"
            value={res.data?.no_data ?? "—"}
            sub="Немає метрик у Zabbix"
            color="border-gray-400"
          />
        </div>
        {/* Avg overview */}
        {overallAvg.cpu != null && (
          <div className="grid grid-cols-2 gap-4 mb-1">
            <div className="bg-white rounded-xl shadow-sm border-l-4 border-blue-300 p-4 flex items-center gap-4">
              <div>
                <p className="text-xs text-gray-500">Середній CPU % по всіх ВМ</p>
                <p className="text-2xl font-bold text-blue-700">{overallAvg.cpu?.toFixed(1)}%</p>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border-l-4 border-purple-300 p-4 flex items-center gap-4">
              <div>
                <p className="text-xs text-gray-500">Середній RAM % по всіх ВМ</p>
                <p className="text-2xl font-bold text-purple-700">{overallAvg.ram?.toFixed(1)}%</p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Top consumers */}
      {res.data && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Топ споживачів ресурсів (середнє за 30 днів)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <TopList title="CPU %" items={topConsumers.cpu} color="bg-blue-500" />
            <TopList title="RAM %" items={topConsumers.ram} color="bg-purple-500" />
            <TopList title="Диск % (використано)" items={topConsumers.disk} color="bg-orange-400" />
          </div>
        </section>
      )}

      {/* Physical servers */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Фізичні сервери
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard title="Всього фіз. серверів" value={phys.data?.total ?? "—"} color="border-purple-500" />
          <StatCard
            title="Під моніторингом"
            value={phys.data?.monitored ?? "—"}
            sub={phys.data ? `${((phys.data.monitored / phys.data.total) * 100).toFixed(0)}% з Zabbix` : ""}
            color="border-green-500"
          />
          <StatCard
            title="Undersized фіз."
            value={phys.data?.items.filter((i) => i.resource_status === "undersized").length ?? "—"}
            sub="Потребують уваги"
            color="border-red-400"
          />
          <StatCard
            title="Oversized фіз."
            value={phys.data?.items.filter((i) => i.resource_status === "oversized").length ?? "—"}
            sub="Надлишок ресурсів"
            color="border-blue-300"
          />
        </div>
      </section>

      {/* Problems shortcut */}
      {((res.data?.undersized ?? 0) > 0 || (res.data?.oversized ?? 0) > 0) && (
        <section className="mb-8">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-amber-800">Є сервери що потребують уваги</p>
              <p className="text-xs text-amber-600 mt-0.5">
                {res.data?.undersized ?? 0} undersized ВМ · {res.data?.oversized ?? 0} oversized ВМ
              </p>
            </div>
            <button
              onClick={() => navigate("/problems")}
              className="text-sm px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition whitespace-nowrap"
            >
              Переглянути →
            </button>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Оптимізація ліцензій Windows DC
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            title="Кластерів"
            value={cl.data?.total_clusters ?? "—"}
            color="border-purple-500"
          />
          <StatCard
            title="Змішаних кластерів"
            value={cl.data?.mixed_clusters ?? "—"}
            sub="Win + Linux"
            color="border-orange-400"
          />
          <StatCard
            title="Поточні ліцензії DC"
            value={cl.data?.total_current_licenses ?? "—"}
            sub="2-core packs"
            color="border-yellow-600"
          />
          <StatCard
            title="Економія після розбивки"
            value={cl.data?.total_savings ?? "—"}
            sub="2-core packs"
            color="border-green-600"
          />
        </div>
      </section>
    </div>
  );
}
