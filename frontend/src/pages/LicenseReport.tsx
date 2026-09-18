import { useState } from "react";
import * as XLSX from "xlsx";
import { useQuery } from "@tanstack/react-query";
import { api, type LicenseHostItem, type LicenseReportResponse } from "../api/client";

// ── XLSX Export ───────────────────────────────────────────────────────────────

function exportToXlsx(data: LicenseReportResponse) {
  const wb = XLSX.utils.book_new();

  // Summary sheet
  const summaryWs = XLSX.utils.json_to_sheet([
    { "Параметр": "Всього ESXi-хостів з Windows Server VM", "Значення": data.total_hosts },
    { "Параметр": "Ціна DC ліцензії (2-core pack, USD)", "Значення": data.dc_price_per_2core },
    { "Параметр": "Ціна Standard ліцензії (2-core pack, USD)", "Значення": data.std_price_per_2core },
    { "Параметр": "Поточні витрати (DC всюди), USD", "Значення": data.total_dc_cost },
    { "Параметр": "Оптимальні витрати, USD", "Значення": data.total_standard_cost },
    { "Параметр": "Потенційна економія, USD", "Значення": data.total_savings },
  ]);
  summaryWs["!cols"] = [{ wch: 50 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, summaryWs, "Підсумок");

  // Per-host sheet
  const hostsWs = XLSX.utils.json_to_sheet(
    data.hosts.map((h) => ({
      "ESXi Хост":       h.host_name,
      "Кластер":         h.cluster ?? "",
      "CPU Ядер":        h.cpu_cores,
      "2-core Пакетів":  h.core_packs,
      "Windows VM":      h.windows_vm_count,
      "Вартість DC, $":  h.dc_cost,
      "Вартість Std, $": h.std_cost,
      "Рекомендація":    h.recommendation === "standard" ? "Standard (вигідніше)" : "Datacenter",
      "Економія, $":     h.savings,
    }))
  );
  hostsWs["!cols"] = [28, 24, 10, 14, 11, 15, 15, 24, 12].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, hostsWs, "Хости");

  // VM list sheet
  const vmRows: { "ESXi Хост": string; "Кластер": string; "VM": string }[] = [];
  for (const h of data.hosts) {
    for (const vm of h.windows_vms) {
      vmRows.push({ "ESXi Хост": h.host_name, "Кластер": h.cluster ?? "", "VM": vm });
    }
  }
  const vmWs = XLSX.utils.json_to_sheet(vmRows);
  vmWs["!cols"] = [28, 24, 36].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, vmWs, "Windows Server VM");

  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `license-report-${date}.xlsx`);
}

// ── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 px-5 py-4 shadow-sm">
      <p className="text-xs text-gray-500 dark:text-slate-400 font-medium uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${accent ?? "text-gray-900 dark:text-white"}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Host Row ─────────────────────────────────────────────────────────────────

function HostRow({ host }: { host: LicenseHostItem }) {
  const [expanded, setExpanded] = useState(false);
  const isStandard = host.recommendation === "standard";

  return (
    <>
      <tr
        className="hover:bg-gray-50 dark:hover:bg-slate-700/40 cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        <td className="px-3 py-2.5 text-sm font-medium text-gray-900 dark:text-white">
          <span className="mr-1 text-gray-400 dark:text-slate-500 text-xs select-none">
            {expanded ? "▼" : "▶"}
          </span>
          {host.host_name}
        </td>
        <td className="px-3 py-2.5 text-sm text-gray-600 dark:text-slate-300">{host.cluster ?? "—"}</td>
        <td className="px-3 py-2.5 text-sm text-right tabular-nums text-gray-600 dark:text-slate-300">
          {host.cpu_cores}
          <span className="ml-1 text-xs text-gray-400">({host.core_packs}×2)</span>
        </td>
        <td className="px-3 py-2.5 text-sm text-right tabular-nums text-gray-600 dark:text-slate-300">
          {host.windows_vm_count}
        </td>
        <td className="px-3 py-2.5 text-sm text-right tabular-nums text-gray-600 dark:text-slate-300">
          ${host.dc_cost.toLocaleString()}
        </td>
        <td className="px-3 py-2.5 text-sm text-right tabular-nums text-gray-600 dark:text-slate-300">
          ${host.std_cost.toLocaleString()}
        </td>
        <td className="px-3 py-2.5 text-sm text-center">
          {isStandard ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
              Standard
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
              Datacenter
            </span>
          )}
        </td>
        <td className="px-3 py-2.5 text-sm text-right tabular-nums font-semibold">
          {host.savings > 0 ? (
            <span className="text-emerald-600 dark:text-emerald-400">
              ${host.savings.toLocaleString()}
            </span>
          ) : (
            <span className="text-gray-400 dark:text-slate-500">—</span>
          )}
        </td>
      </tr>
      {expanded && host.windows_vms.length > 0 && (
        <tr className="bg-gray-50 dark:bg-slate-800/60">
          <td colSpan={8} className="px-6 py-2">
            <div className="flex flex-wrap gap-1.5">
              {host.windows_vms.map((vm) => (
                <span
                  key={vm}
                  className="inline-block px-2 py-0.5 bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded text-xs text-gray-700 dark:text-slate-300"
                >
                  {vm}
                </span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

const usd = (v: number) =>
  v.toLocaleString("uk-UA", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });

export default function LicenseReport() {
  const [search, setSearch] = useState("");
  const [filterRec, setFilterRec] = useState<"all" | "standard" | "datacenter">("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["license-report"],
    queryFn: api.licenseReport,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 dark:text-slate-500">
        Завантаження...
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-64 text-red-500 dark:text-red-400">
        Помилка завантаження даних. Перевірте синхронізацію з vCenter.
      </div>
    );
  }

  const hostsWithSavings  = data.hosts.filter((h) => h.recommendation === "standard").length;
  const hostsDatacenter   = data.hosts.filter((h) => h.recommendation === "datacenter").length;
  const totalWindowsVMs   = data.hosts.reduce((s, h) => s + h.windows_vm_count, 0);

  const filtered = data.hosts.filter((h) => {
    const matchRec = filterRec === "all" || h.recommendation === filterRec;
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      h.host_name.toLowerCase().includes(q) ||
      (h.cluster ?? "").toLowerCase().includes(q) ||
      h.windows_vms.some((vm) => vm.toLowerCase().includes(q));
    return matchRec && matchSearch;
  });

  return (
    <div className="p-6 space-y-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            Ліцензійний звіт Windows Server
          </h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            Datacenter vs Standard по ESXi-хостах &middot; дані станом на{" "}
            {data.synced_at ? new Date(data.synced_at).toLocaleString("uk-UA") : "—"}
          </p>
        </div>
        <button
          onClick={() => exportToXlsx(data)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition"
        >
          <span>⬇</span> Вивантажити XLSX
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard label="Хостів з Windows VM" value={data.total_hosts} />
        <SummaryCard label="Windows Server VM" value={totalWindowsVMs} />
        <SummaryCard
          label="Поточні витрати (DC)"
          value={usd(data.total_dc_cost)}
          sub="якщо всі хости DC"
          accent="text-blue-700 dark:text-blue-400"
        />
        <SummaryCard
          label="Оптимальні витрати"
          value={usd(data.total_standard_cost)}
          sub="після заміни дешевших на Std"
          accent="text-emerald-700 dark:text-emerald-400"
        />
        <SummaryCard
          label="Потенційна економія"
          value={usd(data.total_savings)}
          sub={`${hostsWithSavings} хостів варто замінити`}
          accent={data.total_savings > 0 ? "text-emerald-600 dark:text-emerald-400" : undefined}
        />
        <SummaryCard
          label="Ціни 2-core pack"
          value={`DC $${data.dc_price_per_2core} / Std $${data.std_price_per_2core}`}
          sub="налаштовуються в config.py"
        />
      </div>

      {/* Pricing note */}
      <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-4 py-3 text-sm text-blue-800 dark:text-blue-300">
        <strong>Логіка розрахунку:</strong> DC покриває всі VM на хості — вартість{" "}
        <code className="font-mono">ceil(cores / 2) × ${data.dc_price_per_2core}</code>.{" "}
        Standard покриває 2 VM на ліцензійний набір —{" "}
        <code className="font-mono">ceil(VM / 2) × ceil(cores / 2) × ${data.std_price_per_2core}</code>.{" "}
        Зеленим позначено хости, де Standard вигідніший ({hostsWithSavings} з {data.total_hosts});{" "}
        синім — де DC оптимальний ({hostsDatacenter}).
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Пошук по хосту, кластеру, VM..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-52 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex gap-1">
          {(["all", "standard", "datacenter"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilterRec(f)}
              className={
                "px-3 py-1.5 rounded-lg text-xs font-medium border transition " +
                (filterRec === f
                  ? f === "standard"
                    ? "bg-emerald-100 border-emerald-300 text-emerald-800 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-300"
                    : f === "datacenter"
                    ? "bg-blue-100 border-blue-300 text-blue-800 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300"
                    : "bg-gray-100 border-gray-300 text-gray-700 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-200"
                  : "bg-white border-gray-200 text-gray-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700")
              }
            >
              {f === "all" ? "Всі" : f === "standard" ? "Standard (заміна)" : "Datacenter (OK)"}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-400 dark:text-slate-500">
          {filtered.length} з {data.total_hosts} хостів
        </span>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/50">
                <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                  ESXi Хост
                </th>
                <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                  Кластер
                </th>
                <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide text-right">
                  CPU Ядра
                </th>
                <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide text-right">
                  Win VM
                </th>
                <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide text-right">
                  DC Вартість
                </th>
                <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide text-right">
                  Std Вартість
                </th>
                <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide text-center">
                  Рекомендація
                </th>
                <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide text-right">
                  Економія
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-gray-400 dark:text-slate-500">
                    Немає даних. Перевірте, що синхронізація з vCenter виконана і є VM з OS «Windows Server».
                  </td>
                </tr>
              ) : (
                filtered.map((host) => <HostRow key={host.host_name} host={host} />)
              )}
            </tbody>
          </table>
        </div>

        {/* Table footer */}
        {filtered.length > 0 && (
          <div className="border-t border-gray-100 dark:border-slate-700 px-4 py-2.5 flex items-center justify-between text-xs text-gray-500 dark:text-slate-400 bg-gray-50 dark:bg-slate-700/30">
            <span>
              {filtered.length} хостів · {filtered.reduce((s, h) => s + h.windows_vm_count, 0)} Windows VM
            </span>
            <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              Економія по фільтру: ${filtered.reduce((s, h) => s + h.savings, 0).toLocaleString()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
