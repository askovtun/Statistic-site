import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ResourceItem, type PhysicalServerItem } from "../api/client";
import ResourceBar from "../components/ResourceBar";
import ResourceHistoryModal from "../components/ResourceHistoryModal";

type TabKey = "undersized" | "oversized";

const PERIOD_OPTIONS = [
  { label: "7 днів", value: 7 },
  { label: "14 днів", value: 14 },
  { label: "30 днів", value: 30 },
  { label: "90 днів", value: 90 },
];

type UnifiedRow =
  | { kind: "vm"; item: ResourceItem }
  | { kind: "phys"; item: PhysicalServerItem };

export default function Problems() {
  const [tab, setTab] = useState<TabKey>("undersized");
  const [periodDays, setPeriodDays] = useState(30);
  const [historyVm, setHistoryVm] = useState<string | null>(null);
  const [historyPhys, setHistoryPhys] = useState<string | null>(null);

  const vmsQ = useQuery({
    queryKey: ["resources", periodDays],
    queryFn: () => api.resources(periodDays),
  });
  const physQ = useQuery({
    queryKey: ["physical-servers", periodDays],
    queryFn: () => api.physicalServers(periodDays),
  });

  const { undersized, oversized } = useMemo(() => {
    const vms = vmsQ.data?.items ?? [];
    const phys = physQ.data?.items ?? [];

    const undersized: UnifiedRow[] = [
      ...vms.filter((i) => i.resource_status === "undersized").map((i): UnifiedRow => ({ kind: "vm", item: i })),
      ...phys.filter((i) => i.resource_status === "undersized").map((i): UnifiedRow => ({ kind: "phys", item: i })),
    ].sort((a, b) => {
      const aCpu = (a.kind === "vm" ? a.item.avg_cpu_pct : a.item.avg_cpu_pct) ?? 0;
      const bCpu = (b.kind === "vm" ? b.item.avg_cpu_pct : b.item.avg_cpu_pct) ?? 0;
      return bCpu - aCpu;
    });

    const oversized: UnifiedRow[] = [
      ...vms.filter((i) => i.resource_status === "oversized").map((i): UnifiedRow => ({ kind: "vm", item: i })),
      ...phys.filter((i) => i.resource_status === "oversized").map((i): UnifiedRow => ({ kind: "phys", item: i })),
    ].sort((a, b) => {
      const aCpu = (a.item.avg_cpu_pct) ?? 100;
      const bCpu = (b.item.avg_cpu_pct) ?? 100;
      return aCpu - bCpu;
    });

    return { undersized, oversized };
  }, [vmsQ.data, physQ.data]);

  const rows = tab === "undersized" ? undersized : oversized;
  const isLoading = vmsQ.isLoading || physQ.isLoading;

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-gray-800">Проблемні сервери</h1>
        <select
          value={periodDays}
          onChange={(e) => setPeriodDays(Number(e.target.value))}
          className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white"
        >
          {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        ВМ та фізичні сервери що потребують уваги — за даними Zabbix
      </p>

      {/* Summary */}
      <div className="flex gap-4 mb-6 flex-wrap">
        <div className="bg-white rounded-xl shadow-sm border-l-4 border-red-400 px-5 py-4">
          <p className="text-xs text-gray-500">Undersized ВМ</p>
          <p className="text-2xl font-bold text-red-600">
            {vmsQ.data?.items.filter((i) => i.resource_status === "undersized").length ?? "—"}
          </p>
          <p className="text-xs text-gray-400">Не вистачає ресурсів</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border-l-4 border-red-300 px-5 py-4">
          <p className="text-xs text-gray-500">Undersized фіз.</p>
          <p className="text-2xl font-bold text-red-500">
            {physQ.data?.items.filter((i) => i.resource_status === "undersized").length ?? "—"}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border-l-4 border-blue-400 px-5 py-4">
          <p className="text-xs text-gray-500">Oversized ВМ</p>
          <p className="text-2xl font-bold text-blue-600">
            {vmsQ.data?.items.filter((i) => i.resource_status === "oversized").length ?? "—"}
          </p>
          <p className="text-xs text-gray-400">Ресурсів більше ніж потрібно</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border-l-4 border-blue-300 px-5 py-4">
          <p className="text-xs text-gray-500">Oversized фіз.</p>
          <p className="text-2xl font-bold text-blue-500">
            {physQ.data?.items.filter((i) => i.resource_status === "oversized").length ?? "—"}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab("undersized")}
          className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${
            tab === "undersized"
              ? "bg-red-600 text-white border-red-600"
              : "bg-white text-gray-600 border-gray-300 hover:border-red-400"
          }`}
        >
          Undersized ({undersized.length})
        </button>
        <button
          onClick={() => setTab("oversized")}
          className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${
            tab === "oversized"
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
          }`}
        >
          Oversized ({oversized.length})
        </button>
      </div>

      {isLoading && <p className="text-gray-400 animate-pulse">Завантаження...</p>}

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <div className="max-h-[calc(100vh-380px)] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Сервер</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Тип</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Кластер / Локація</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600">CPU % (пік)</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600">RAM % (пік)</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Рекомендації</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => {
                  const name = r.item.name;
                  const isVm = r.kind === "vm";
                  const vm = isVm ? (r.item as ResourceItem) : null;
                  const phys = !isVm ? (r.item as PhysicalServerItem) : null;
                  const location = vm ? (vm.cluster ?? "—") : (phys?.location ?? "—");
                  const recs = vm?.recommendations ?? [];

                  return (
                    <tr key={`${r.kind}-${name}`} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <button
                          onClick={() => isVm ? setHistoryVm(name) : setHistoryPhys(name)}
                          className="font-medium text-blue-600 hover:underline text-left text-xs"
                        >
                          {name}
                        </button>
                        <p className="text-[10px] text-gray-400">{r.item.fqdn ?? ""}</p>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${isVm ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"}`}>
                          {isVm ? "ВМ" : "Фіз."}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                        {location}
                      </td>
                      <td className="px-4 py-2.5">
                        <ResourceBar pct={r.item.avg_cpu_pct} peakPct={r.item.max_cpu_pct} />
                      </td>
                      <td className="px-4 py-2.5">
                        <ResourceBar pct={r.item.avg_ram_pct} peakPct={r.item.max_ram_pct} />
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-gray-500 max-w-xs">
                        {recs.length > 0 ? (
                          <ul className="list-none space-y-0.5">
                            {recs.map((rec, i) => <li key={i}>• {rec}</li>)}
                          </ul>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
                {!isLoading && rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-gray-400">
                      {tab === "undersized" ? "Undersized серверів не знайдено" : "Oversized серверів не знайдено"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {historyVm && (
        <ResourceHistoryModal name={historyVm} onClose={() => setHistoryVm(null)} />
      )}
      {historyPhys && (
        <ResourceHistoryModal
          name={historyPhys}
          historyFn={(name, days) => api.physicalServerHistory(name, days)}
          onClose={() => setHistoryPhys(null)}
          showVCenter={false}
        />
      )}
    </div>
  );
}
