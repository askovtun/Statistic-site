import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type VCenterHealthItem, type VCenterSnapshotItem, type VCenterHostItem } from "../api/client";
import Pagination from "../components/Pagination";

const PAGE_SIZE = 50;

// ── Shared helpers ────────────────────────────────────────────────────────────

function PowerBadge({ state }: { state: string }) {
  if (state === "poweredOn")
    return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">Увімк.</span>;
  if (state === "poweredOff")
    return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Вимк.</span>;
  if (state === "suspended")
    return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Suspend</span>;
  return <span className="text-xs text-gray-400">{state}</span>;
}

function MemKb({ kb }: { kb: number | null }) {
  if (kb == null || kb === 0) return <span className="text-gray-300 text-xs">—</span>;
  const mb = kb / 1024;
  const label = mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
  return <span className="text-xs font-medium text-red-600">{label}</span>;
}

function UsagePct({ pct, warnAt = 70, critAt = 90 }: { pct: number | null; warnAt?: number; critAt?: number }) {
  if (pct == null) return <span className="text-gray-300 text-xs">—</span>;
  const color = pct >= critAt ? "bg-red-500" : pct >= warnAt ? "bg-amber-400" : "bg-blue-400";
  const textColor = pct >= critAt ? "text-red-600" : pct >= warnAt ? "text-amber-600" : "text-gray-600";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={`text-xs font-medium ${textColor}`}>{pct.toFixed(1)}%</span>
    </div>
  );
}

// ── CPU Ready bar (5x scale so 20% = full bar) ───────────────────────────────

function ReadyBar({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-gray-300 text-xs">—</span>;
  const color = pct >= 10 ? "bg-red-500" : pct >= 5 ? "bg-amber-400" : "bg-green-400";
  const textColor = pct >= 10 ? "text-red-600" : pct >= 5 ? "text-amber-600" : "text-green-700";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-20 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct * 5, 100)}%` }} />
      </div>
      <span className={`text-xs font-medium ${textColor}`}>{pct.toFixed(2)}%</span>
    </div>
  );
}

function OvercommitCell({ ratio, vcpus, cores }: { ratio: number | null; vcpus: number; cores: number | null }) {
  if (ratio == null || vcpus === 0) return <span className="text-gray-300 text-xs">—</span>;
  const isCrit = ratio > 6;
  const isWarn = ratio > 4;
  const bg = isCrit ? "bg-red-100 text-red-700" : isWarn ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${bg}`}
      title={`${vcpus} vCPU / ${cores ?? "?"} ядер`}>
      {ratio.toFixed(1)}:1
    </span>
  );
}

function HostStatusBadge({ status }: { status: string }) {
  if (status === "critical")
    return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">Критично</span>;
  if (status === "warning")
    return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Попередження</span>;
  return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">OK</span>;
}

// ── Health tab ────────────────────────────────────────────────────────────────

type HealthSortKey = "name" | "cluster" | "cpu_ready_pct" | "mem_balloon_kb" | "mem_swapped_kb" | "disk_used_pct";

function rowBg(item: VCenterHealthItem) {
  if (item.cpu_ready_pct != null && item.cpu_ready_pct >= 10) return "bg-red-50 hover:bg-red-100";
  if (item.cpu_ready_pct != null && item.cpu_ready_pct >= 5) return "bg-amber-50 hover:bg-amber-100";
  return item.power_state === "poweredOff" ? "opacity-60 hover:bg-gray-50" : "hover:bg-gray-50";
}

function HealthTab({ days }: { days: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["vcenterHealth", days],
    queryFn: () => api.vcenterHealth(days),
  });

  const [search, setSearch] = useState("");
  const [clusterFilter, setClusterFilter] = useState("");
  const [powerFilter, setPowerFilter] = useState("all");
  const [cpuReadyFilter, setCpuReadyFilter] = useState(false);
  const [balloonFilter, setBalloonFilter] = useState(false);
  const [swapFilter, setSwapFilter] = useState(false);
  const [snapshotFilter, setSnapshotFilter] = useState(false);
  const [sortKey, setSortKey] = useState<HealthSortKey>("cpu_ready_pct");
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleSort(key: HealthSortKey) {
    if (sortKey === key) setSortDesc((d) => !d);
    else { setSortKey(key); setSortDesc(true); }
    setPage(1);
  }

  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function SortTh({ k, label }: { k: HealthSortKey; label: string }) {
    const active = sortKey === k;
    return (
      <th className="px-3 py-3 text-left cursor-pointer select-none hover:text-gray-700" onClick={() => toggleSort(k)}>
        <span className="flex items-center gap-1">
          {label}
          <span className="text-gray-400">{active ? (sortDesc ? "↓" : "↑") : "↕"}</span>
        </span>
      </th>
    );
  }

  const clusters = Array.from(new Set((data?.items ?? []).map((i) => i.cluster).filter(Boolean) as string[])).sort();

  const filtered = (data?.items ?? []).filter((i) => {
    if (powerFilter === "on" && i.power_state !== "poweredOn") return false;
    if (powerFilter === "off" && i.power_state !== "poweredOff") return false;
    if (clusterFilter && i.cluster !== clusterFilter) return false;
    if (cpuReadyFilter && (i.cpu_ready_pct == null || i.cpu_ready_pct < 5)) return false;
    if (balloonFilter && (i.mem_balloon_kb == null || i.mem_balloon_kb === 0)) return false;
    if (swapFilter && (i.mem_swapped_kb == null || i.mem_swapped_kb === 0)) return false;
    if (snapshotFilter && i.snapshot_count === 0) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!i.name.toLowerCase().includes(q) && !(i.cluster ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey] ?? -Infinity;
    const bv = b[sortKey] ?? -Infinity;
    if (typeof av === "string" && typeof bv === "string") return sortDesc ? bv.localeCompare(av) : av.localeCompare(bv);
    return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number);
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageItems = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (isLoading) return <p className="text-gray-400 animate-pulse">Завантаження...</p>;
  if (error) return <p className="text-red-500 text-sm">Помилка: {String(error)}</p>;

  return (
    <>
      {data && (
        <div className="flex flex-wrap gap-3 mb-5">
          {[
            { label: `Усі (${data.total_vms})`, val: "all" },
            { label: `Увімкнені (${data.powered_on})`, val: "on" },
            { label: `Вимкнені (${data.powered_off})`, val: "off" },
          ].map(({ label, val }) => (
            <button key={val} onClick={() => { setPowerFilter(val); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ${powerFilter === val ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"}`}>
              {label}
            </button>
          ))}
          {data.with_cpu_ready_warn > 0 && (
            <button
              onClick={() => { setCpuReadyFilter((f) => !f); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ${cpuReadyFilter ? "bg-amber-500 text-white border-amber-500" : "bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100"}`}>
              CPU Ready ≥5%: {data.with_cpu_ready_warn} ВМ
            </button>
          )}
          {data.with_balloon > 0 && (
            <button
              onClick={() => { setBalloonFilter((f) => !f); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ${balloonFilter ? "bg-red-500 text-white border-red-500" : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"}`}>
              Balloon: {data.with_balloon} ВМ
            </button>
          )}
          {data.with_swap > 0 && (
            <button
              onClick={() => { setSwapFilter((f) => !f); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ${swapFilter ? "bg-red-500 text-white border-red-500" : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"}`}>
              Swap: {data.with_swap} ВМ
            </button>
          )}
          {data.with_snapshots > 0 && (
            <button
              onClick={() => { setSnapshotFilter((f) => !f); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ${snapshotFilter ? "bg-purple-500 text-white border-purple-500" : "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100"}`}>
              Знімки: {data.with_snapshots} ВМ
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
        <input type="text" placeholder="Пошук за назвою, кластером..." value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-400" />
        <select value={clusterFilter} onChange={(e) => { setClusterFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
          <option value="">Всі кластери</option>
          {clusters.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-3 py-3 w-6" />
                <SortTh k="name" label="ВМ" />
                <SortTh k="cluster" label="Кластер" />
                <th className="px-3 py-3 text-left">Стан</th>
                <th className="px-3 py-3 text-left">vCPU / vRAM</th>
                <SortTh k="cpu_ready_pct" label="CPU Ready %" />
                <SortTh k="mem_balloon_kb" label="Balloon" />
                <SortTh k="mem_swapped_kb" label="Swap" />
                <SortTh k="disk_used_pct" label="Диск %" />
                <th className="px-3 py-3 text-left">Знімки</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageItems.map((item) => {
                const isExpanded = expanded.has(item.name);
                const hasRecs = item.recommendations.length > 0;
                return (
                  <>
                    <tr key={item.name} className={`${rowBg(item)} transition-colors`}>
                      <td className="px-3 py-2.5">
                        {hasRecs && (
                          <button onClick={() => toggleExpand(item.name)}
                            className="text-gray-400 hover:text-red-600 transition font-bold text-xs w-4"
                            title="Показати рекомендації">
                            {isExpanded ? "▲" : "▼"}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-medium whitespace-nowrap">
                        {hasRecs ? (
                          <button onClick={() => toggleExpand(item.name)}
                            className={`text-left font-medium hover:underline ${item.cpu_ready_pct != null && item.cpu_ready_pct >= 10 ? "text-red-700" : item.cpu_ready_pct != null && item.cpu_ready_pct >= 5 ? "text-amber-700" : "text-gray-800"}`}>
                            {item.name}
                          </button>
                        ) : (
                          <span>{item.name}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-gray-500 text-xs">{item.cluster ?? "—"}</td>
                      <td className="px-3 py-2.5"><PowerBadge state={item.power_state} /></td>
                      <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                        {item.vcpu != null ? `${item.vcpu}c` : "—"} / {item.vram_gb != null ? `${item.vram_gb}GB` : "—"}
                      </td>
                      <td className="px-3 py-2.5"><ReadyBar pct={item.cpu_ready_pct} /></td>
                      <td className="px-3 py-2.5"><MemKb kb={item.mem_balloon_kb} /></td>
                      <td className="px-3 py-2.5"><MemKb kb={item.mem_swapped_kb} /></td>
                      <td className="px-3 py-2.5 text-xs text-gray-600">
                        {item.disk_used_pct != null ? `${item.disk_used_pct.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        {item.snapshot_count > 0
                          ? <span className="text-xs font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full">{item.snapshot_count}</span>
                          : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                    </tr>
                    {isExpanded && hasRecs && (
                      <tr key={`${item.name}-recs`} className="bg-red-50 border-l-4 border-red-400">
                        <td colSpan={10} className="px-4 py-3">
                          <p className="text-xs font-semibold text-red-700 mb-1.5">Рекомендації для {item.name}:</p>
                          <ul className="space-y-1">
                            {item.recommendations.map((r, i) => (
                              <li key={i} className="flex gap-2 text-xs text-red-800">
                                <span className="mt-0.5 shrink-0">•</span>
                                <span>{r}</span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
        {sorted.length === 0 && <p className="text-center py-8 text-gray-400 text-sm">Нічого не знайдено</p>}
      </div>

      {sorted.length > 0 && (
        <>
          <p className="text-center text-xs text-gray-400 mt-3">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} з {sorted.length}
          </p>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </>
  );
}

// ── Hosts (hypervisors) tab ───────────────────────────────────────────────────

type HostSortKey = "name" | "cluster" | "cpu_usage_pct" | "mem_usage_pct" | "avg_vm_cpu_ready_pct" | "max_vm_cpu_ready_pct" | "vm_count" | "cpu_overcommit_ratio";

function HostsTab({ days }: { days: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["vcenterHosts", days],
    queryFn: () => api.vcenterHosts(days),
  });

  const [search, setSearch] = useState("");
  const [clusterFilter, setClusterFilter] = useState("");
  const [sortKey, setSortKey] = useState<HostSortKey>("avg_vm_cpu_ready_pct");
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(1);

  function toggleSort(key: HostSortKey) {
    if (sortKey === key) setSortDesc((d) => !d);
    else { setSortKey(key); setSortDesc(true); }
    setPage(1);
  }

  function SortTh({ k, label, title }: { k: HostSortKey; label: string; title?: string }) {
    const active = sortKey === k;
    return (
      <th className="px-3 py-3 text-left cursor-pointer select-none hover:text-gray-700 whitespace-nowrap"
        title={title} onClick={() => toggleSort(k)}>
        <span className="flex items-center gap-1">
          {label}
          <span className="text-gray-400">{active ? (sortDesc ? "↓" : "↑") : "↕"}</span>
        </span>
      </th>
    );
  }

  const clusters = Array.from(new Set((data?.items ?? []).map((i) => i.cluster).filter(Boolean) as string[])).sort();

  const filtered = (data?.items ?? []).filter((i) => {
    if (clusterFilter && i.cluster !== clusterFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!i.name.toLowerCase().includes(q) && !(i.cluster ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = (a[sortKey] as string | number | null | undefined) ?? -Infinity;
    const bv = (b[sortKey] as string | number | null | undefined) ?? -Infinity;
    if (typeof av === "string" && typeof bv === "string") return sortDesc ? bv.localeCompare(av) : av.localeCompare(bv);
    return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number);
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageItems = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (isLoading) return <p className="text-gray-400 animate-pulse">Завантаження...</p>;
  if (error) return <p className="text-red-500 text-sm">Помилка: {String(error)}</p>;

  function hostRowBg(h: VCenterHostItem) {
    if (h.status === "critical") return "bg-red-50 hover:bg-red-100";
    if (h.status === "warning") return "bg-amber-50 hover:bg-amber-100";
    return "hover:bg-gray-50";
  }

  return (
    <>
      {data && (
        <div className="flex flex-wrap gap-3 mb-5">
          <span className="px-3 py-1.5 rounded-full text-sm font-medium bg-gray-100 text-gray-700 border border-gray-200">
            Хостів: {data.total_hosts}
          </span>
          <span className="px-3 py-1.5 rounded-full text-sm font-medium bg-green-50 text-green-700 border border-green-200">
            Увімкнено: {data.powered_on}
          </span>
          {data.hosts_with_ready_warn > 0 && (
            <span className="px-3 py-1.5 rounded-full text-sm font-medium bg-amber-50 text-amber-700 border border-amber-300">
              З попередженнями: {data.hosts_with_ready_warn}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
        <input type="text" placeholder="Пошук за назвою хоста..." value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-400" />
        <select value={clusterFilter} onChange={(e) => { setClusterFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
          <option value="">Всі кластери</option>
          {clusters.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {(!data || sorted.length === 0) ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <p className="text-gray-400 text-sm">
            {data ? "Хостів не знайдено." : "Дані ESXi-хостів завантажуються після першої синхронізації з vCenter."}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-3 py-3 text-left">Статус</th>
                  <SortTh k="name" label="ESXi Хост" />
                  <SortTh k="cluster" label="Кластер" />
                  <th className="px-3 py-3 text-left whitespace-nowrap">CPU ядра</th>
                  <th className="px-3 py-3 text-left">RAM</th>
                  <SortTh k="cpu_usage_pct" label="CPU %" title="Поточне навантаження хоста (quickStats)" />
                  <SortTh k="mem_usage_pct" label="RAM %" title="Поточне навантаження пам'яті (quickStats)" />
                  <SortTh k="vm_count" label="ВМ" title="Кількість ВМ з даними за период" />
                  <SortTh k="cpu_overcommit_ratio" label="vCPU:Core" title="CPU Overcommit Ratio = сума vCPU всіх ВМ / фізичні ядра хоста. Жовтий >4:1, Червоний >6:1" />
                  <SortTh k="avg_vm_cpu_ready_pct" label="CPU Ready (сер.)" title="Середнє CPU Ready % серед усіх ВМ на цьому хості" />
                  <SortTh k="max_vm_cpu_ready_pct" label="CPU Ready (макс.)" title="Максимальне CPU Ready % серед ВМ на цьому хості" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pageItems.map((h) => (
                  <tr key={h.moid} className={`${hostRowBg(h)} transition-colors`}>
                    <td className="px-3 py-2.5"><HostStatusBadge status={h.status} /></td>
                    <td className="px-3 py-2.5 font-medium whitespace-nowrap">{h.name}</td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs">{h.cluster ?? "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">
                      {h.num_cpu_cores != null ? `${h.num_cpu_cores} cores` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">
                      {h.memory_gb != null ? `${h.memory_gb} GB` : "—"}
                    </td>
                    <td className="px-3 py-2.5"><UsagePct pct={h.cpu_usage_pct} /></td>
                    <td className="px-3 py-2.5"><UsagePct pct={h.mem_usage_pct} /></td>
                    <td className="px-3 py-2.5 text-xs text-gray-600">
                      {h.vms_with_data > 0 ? `${h.vms_with_data} / ${h.vm_count}` : h.vm_count > 0 ? `0 / ${h.vm_count}` : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <OvercommitCell ratio={h.cpu_overcommit_ratio} vcpus={h.total_vcpus} cores={h.num_cpu_cores} />
                    </td>
                    <td className="px-3 py-2.5"><ReadyBar pct={h.avg_vm_cpu_ready_pct} /></td>
                    <td className="px-3 py-2.5"><ReadyBar pct={h.max_vm_cpu_ready_pct} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sorted.length > 0 && (
        <>
          <p className="text-center text-xs text-gray-400 mt-3">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} з {sorted.length}
          </p>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </>
  );
}

// ── Snapshots tab ─────────────────────────────────────────────────────────────

function SnapshotsTab() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["vcenterSnapshots"],
    queryFn: api.vcenterSnapshots,
    staleTime: 0,
  });

  const refresh = useMutation({
    mutationFn: api.refreshSnapshots,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vcenterSnapshots"] }),
  });

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filtered = (data?.snapshots ?? []).filter((s: VCenterSnapshotItem) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return s.vm_name.toLowerCase().includes(q) || s.name.toLowerCase().includes(q);
  });

  const sorted = [...filtered].sort((a, b) => b.age_days - a.age_days);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageItems = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function ageColor(days: number) {
    if (days >= 30) return "text-red-600 font-semibold";
    if (days >= 7) return "text-amber-600";
    return "text-green-600";
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => refresh.mutate()} disabled={refresh.isPending}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 transition disabled:opacity-50">
          {refresh.isPending ? "Завантаження з vCenter..." : "Оновити знімки з vCenter"}
        </button>
        {refresh.isError && <span className="text-red-500 text-sm">Помилка: {String(refresh.error)}</span>}
        {data && <span className="text-sm text-gray-500">Знайдено: {data.total} знімків</span>}
        <input type="text" placeholder="Пошук за ВМ, назвою знімка..."
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="ml-auto w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-400" />
      </div>

      {!data || data.total === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <p className="text-gray-400 text-sm mb-3">
            {data ? "Знімків не знайдено." : "Натисніть «Оновити знімки з vCenter» щоб завантажити список."}
          </p>
          <p className="text-xs text-gray-300">Дані завантажуються напряму з vCenter (~5–15 сек).</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">ВМ</th>
                  <th className="px-4 py-3 text-left">Назва знімка</th>
                  <th className="px-4 py-3 text-left">Опис</th>
                  <th className="px-4 py-3 text-left">Дата створення</th>
                  <th className="px-4 py-3 text-left">Вік</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pageItems.map((s, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium">{s.vm_name}</td>
                    <td className="px-4 py-2.5 text-gray-700">{s.name}</td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs max-w-xs truncate">{s.description || "—"}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(s.created_at).toLocaleString("uk-UA")}
                    </td>
                    <td className={`px-4 py-2.5 text-xs ${ageColor(s.age_days)}`}>
                      {s.age_days === 0 ? "Сьогодні" : s.age_days === 1 ? "1 день" : `${s.age_days} днів`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sorted.length > PAGE_SIZE && (
            <>
              <p className="text-center text-xs text-gray-400 mt-3">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} з {sorted.length}
              </p>
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </>
          )}
        </>
      )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = "health" | "hosts" | "snapshots";

export default function VCenter() {
  const [tab, setTab] = useState<Tab>("health");
  const [days, setDays] = useState(30);

  const showPeriod = tab === "health" || tab === "hosts";

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-800">vCenter Health</h1>
        {showPeriod && (
          <label className="text-sm text-gray-500">
            Період:&nbsp;
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1 text-sm">
              <option value={7}>7 днів</option>
              <option value={14}>14 днів</option>
              <option value={30}>30 днів</option>
              <option value={90}>90 днів</option>
            </select>
          </label>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-5">
        CPU Ready (затримка планувальника), Memory Balloon/Swap (тиск пам'яті), стан ВМ та знімки
      </p>

      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {([
          { key: "health", label: "Здоров'я ВМ" },
          { key: "hosts", label: "Гіпервізори (ESXi)" },
          { key: "snapshots", label: "Знімки (Snapshots)" },
        ] as { key: Tab; label: string }[]).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition -mb-px ${
              tab === key ? "border-blue-600 text-blue-700 bg-white" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "health" && <HealthTab days={days} />}
      {tab === "hosts" && <HostsTab days={days} />}
      {tab === "snapshots" && <SnapshotsTab />}
    </div>
  );
}
