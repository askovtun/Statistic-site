import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

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

export default function Dashboard() {
  const comp = useQuery({ queryKey: ["comparison"], queryFn: api.comparison });
  const res = useQuery({ queryKey: ["resources"], queryFn: () => api.resources() });
  const cl = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });

  const loading = comp.isLoading || res.isLoading || cl.isLoading;

  return (
    <div className="p-8">
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
      </section>

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
