import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { VmAgeItem } from "../api/client";

type AgeFilter = "all" | "365" | "730" | "1825";

const AGE_FILTERS: { value: AgeFilter; label: string }[] = [
  { value: "all",  label: "Всі" },
  { value: "365",  label: "> 1 рік" },
  { value: "730",  label: "> 2 роки" },
  { value: "1825", label: "> 5 років" },
];

function ageBadge(days: number | null) {
  if (days === null) return <span className="text-gray-300 dark:text-slate-600 text-xs">—</span>;
  const years = days / 365;
  const label = days > 365
    ? `${(years).toFixed(1)}р`
    : `${days}д`;
  const color =
    days > 1825
      ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
      : days > 730
      ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
      : days > 365
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
      : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
  return (
    <span className={`px-2 py-0.5 text-xs rounded-full font-semibold ${color}`}>{label}</span>
  );
}

export default function VmAge() {
  const [ageFilter, setAgeFilter] = useState<AgeFilter>("all");
  const [search, setSearch] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["vm-age"],
    queryFn: api.vmAge,
  });

  const vms: VmAgeItem[] = data?.vms ?? [];

  const filtered = vms.filter((v) => {
    if (ageFilter !== "all" && (v.age_days ?? 0) <= Number(ageFilter)) return false;
    if (search) return v.name.toLowerCase().includes(search.toLowerCase());
    return true;
  }).sort((a, b) =>
    sortDir === "desc"
      ? (b.age_days ?? -1) - (a.age_days ?? -1)
      : (a.age_days ?? 99999) - (b.age_days ?? 99999)
  );

  const old5y  = vms.filter((v) => (v.age_days ?? 0) > 1825).length;
  const old2y  = vms.filter((v) => (v.age_days ?? 0) > 730).length;
  const old1y  = vms.filter((v) => (v.age_days ?? 0) > 365).length;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Вік VM</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            Дата створення VM у vCenter — знайдіть найстаріші машини в парку
          </p>
        </div>
        {data?.synced_at && (
          <div className="text-xs text-gray-400 dark:text-slate-500">
            Дані на: {new Date(data.synced_at).toLocaleString("uk-UA")}
          </div>
        )}
      </div>

      {data && (
        <div className="flex flex-wrap gap-3">
          {[
            { label: "Всього VM",           value: data.total },
            { label: "З датою створення",   value: data.with_create_date },
            { label: "> 1 рік",             value: old1y, warn: old1y > 0 },
            { label: "> 2 роки",            value: old2y, warn: old2y > 0 },
            { label: "> 5 років",           value: old5y, warn: old5y > 0 },
            { label: "Найстаріша",          value: data.oldest_days != null ? `${Math.floor(data.oldest_days / 365)}р ${data.oldest_days % 365}д` : "—" },
          ].map(({ label, value, warn }) => (
            <div key={label} className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 min-w-[130px]">
              <div className={`text-2xl font-bold ${warn ? "text-orange-600 dark:text-orange-400" : "text-gray-900 dark:text-white"}`}>{value}</div>
              <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        {AGE_FILTERS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setAgeFilter(value)}
            className={
              "px-3 py-1.5 rounded-lg text-sm border transition " +
              (ageFilter === value
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-blue-400")
            }
          >
            {label}
          </button>
        ))}
        <input
          type="search"
          placeholder="Пошук VM..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-2 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 w-48"
        />
        <span className="text-xs text-gray-400 dark:text-slate-500 ml-auto">{filtered.length} VM</span>
      </div>

      {isLoading && <div className="text-center text-gray-400 py-12">Завантаження...</div>}
      {isError && <div className="text-center text-red-500 py-12">Помилка завантаження.</div>}

      {filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">VM</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Кластер</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Статус</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Power</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-slate-300">vCPU</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-slate-300">vRAM</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Дата створення</th>
                <th
                  className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300 cursor-pointer select-none"
                  onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
                >
                  Вік {sortDir === "desc" ? "▼" : "▲"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800 bg-white dark:bg-slate-950">
              {filtered.map((v) => (
                <tr key={v.name} className="hover:bg-gray-50 dark:hover:bg-slate-900/60 transition-colors">
                  <td className="px-4 py-2 font-mono text-xs text-blue-700 dark:text-blue-400">{v.name}</td>
                  <td className="px-4 py-2 text-xs text-gray-500 dark:text-slate-400">{v.cluster || "—"}</td>
                  <td className="px-4 py-2 text-xs text-gray-600 dark:text-slate-300">{v.cmdb_status || "—"}</td>
                  <td className="px-4 py-2 text-xs">
                    <span className={v.power_state === "poweredOn" ? "text-green-600 dark:text-green-400" : "text-gray-400"}>
                      {v.power_state === "poweredOn" ? "On" : v.power_state === "poweredOff" ? "Off" : v.power_state || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-gray-700 dark:text-slate-300">{v.vcpu ?? "—"}</td>
                  <td className="px-4 py-2 text-right text-xs text-gray-700 dark:text-slate-300">{v.vram_gb ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-gray-400 dark:text-slate-500">
                    {v.created_at ? new Date(v.created_at).toLocaleDateString("uk-UA") : "—"}
                  </td>
                  <td className="px-4 py-2">{ageBadge(v.age_days)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
