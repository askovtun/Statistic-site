import { useMemo } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import ResourceBar from "./ResourceBar";

const statusLabel = {
  undersized: "Undersized",
  oversized: "Oversized",
  optimal: "Оптимально",
  no_data: "—",
};

const statusColor = {
  undersized: "text-red-600 font-medium",
  oversized: "text-blue-600",
  optimal: "text-green-600",
  no_data: "text-gray-400",
};

export default function ClusterVmsModal({
  clusterName,
  onClose,
}: {
  clusterName: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["resources"],
    queryFn: () => api.resources(),
  });

  const vms = useMemo(
    () =>
      (data?.items ?? [])
        .filter((i) => i.cluster === clusterName)
        .sort((a, b) => (b.avg_cpu_pct ?? 0) - (a.avg_cpu_pct ?? 0)),
    [data, clusterName]
  );

  const undersized = vms.filter((v) => v.resource_status === "undersized").length;
  const oversized = vms.filter((v) => v.resource_status === "oversized").length;

  return createPortal(
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-800">{clusterName}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {vms.length} ВМ
              {undersized > 0 && (
                <span className="ml-2 text-red-500">{undersized} undersized</span>
              )}
              {oversized > 0 && (
                <span className="ml-2 text-blue-500">{oversized} oversized</span>
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="overflow-auto flex-1">
          {isLoading && <p className="text-center text-gray-400 p-8 animate-pulse">Завантаження...</p>}
          {!isLoading && vms.length === 0 && (
            <p className="text-center text-gray-400 p-8">Немає ВМ у цьому кластері</p>
          )}
          {vms.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600">ВМ</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600">OS</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600">vCPU</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600">vRAM</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600">CPU % (пік)</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600">RAM % (пік)</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {vms.map((vm) => (
                  <tr key={vm.name} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-800 text-xs">{vm.name}</p>
                      {vm.fqdn && <p className="text-xs text-gray-400">{vm.fqdn}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                      {vm.os_family ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-600">{vm.vcpu ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">
                      {vm.vram_gb != null ? `${vm.vram_gb} GB` : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <ResourceBar pct={vm.avg_cpu_pct} peakPct={vm.max_cpu_pct} />
                    </td>
                    <td className="px-4 py-2.5">
                      <ResourceBar pct={vm.avg_ram_pct} peakPct={vm.max_ram_pct} />
                    </td>
                    <td className={`px-4 py-2.5 text-xs whitespace-nowrap ${statusColor[vm.resource_status]}`}>
                      {statusLabel[vm.resource_status]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
