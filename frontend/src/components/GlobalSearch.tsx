import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import ResourceHistoryModal from "./ResourceHistoryModal";

type ResultType = "vm" | "phys" | "cmdb_only" | "zabbix_only";

interface SearchResult {
  type: ResultType;
  name: string;
  sub: string;
}

const typeLabel: Record<ResultType, string> = {
  vm: "ВМ",
  phys: "Фіз. сервер",
  cmdb_only: "Тільки CMDB",
  zabbix_only: "Тільки Zabbix",
};

const typeBadgeClass: Record<ResultType, string> = {
  vm: "bg-blue-50 text-blue-700",
  phys: "bg-purple-50 text-purple-700",
  cmdb_only: "bg-yellow-50 text-yellow-700",
  zabbix_only: "bg-red-50 text-red-700",
};

export default function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<{ name: string; type: "vm" | "phys" } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const enabled = query.trim().length >= 2;

  const resQ = useQuery({ queryKey: ["resources"], queryFn: () => api.resources(), enabled });
  const physQ = useQuery({ queryKey: ["physical-servers", 30], queryFn: () => api.physicalServers(30), enabled });
  const compQ = useQuery({ queryKey: ["comparison"], queryFn: api.comparison, enabled });

  const results = useMemo<SearchResult[]>(() => {
    if (!enabled) return [];
    const q = query.toLowerCase();

    const out: SearchResult[] = [];
    const vmNames = new Set<string>();

    (resQ.data?.items ?? []).forEach((i) => {
      if (
        i.name.toLowerCase().includes(q) ||
        (i.fqdn ?? "").toLowerCase().includes(q) ||
        (i.primary_ip ?? "").includes(q)
      ) {
        vmNames.add(i.name.toLowerCase());
        out.push({ type: "vm", name: i.name, sub: [i.cluster, i.fqdn].filter(Boolean).join(" · ") });
      }
    });

    (physQ.data?.items ?? []).forEach((i) => {
      if (
        i.name.toLowerCase().includes(q) ||
        (i.fqdn ?? "").toLowerCase().includes(q) ||
        (i.primary_ip ?? "").includes(q)
      ) {
        out.push({ type: "phys", name: i.name, sub: [i.location, i.fqdn].filter(Boolean).join(" · ") });
      }
    });

    (compQ.data?.items ?? [])
      .filter((i) => i.comparison_status !== "both" && !vmNames.has(i.name.toLowerCase()))
      .forEach((i) => {
        if (i.name.toLowerCase().includes(q) || (i.fqdn ?? "").toLowerCase().includes(q)) {
          out.push({
            type: i.comparison_status as ResultType,
            name: i.name,
            sub: i.fqdn ?? "",
          });
        }
      });

    return out.slice(0, 15);
  }, [query, enabled, resQ.data, physQ.data, compQ.data]);

  useEffect(() => {
    setOpen(enabled && results.length > 0);
  }, [enabled, results.length]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || inputRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function handleResultClick(r: SearchResult) {
    setOpen(false);
    setQuery("");
    if (r.type === "vm") {
      setHistory({ name: r.name, type: "vm" });
    } else if (r.type === "phys") {
      setHistory({ name: r.name, type: "phys" });
    } else if (r.type === "cmdb_only") {
      navigate("/comparison");
    } else {
      navigate("/comparison");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); setQuery(""); }
  }

  return (
    <>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => enabled && results.length > 0 && setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Пошук серверів..."
          className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 w-48 focus:outline-none focus:border-blue-400 focus:w-64 transition-all bg-gray-50"
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setOpen(false); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
          >
            ×
          </button>
        )}

        {open && results.length > 0 && (
          <div
            ref={popRef}
            className="absolute top-full right-0 mt-1 w-80 bg-white rounded-xl shadow-lg border border-gray-200 z-50 overflow-hidden"
          >
            <div className="max-h-80 overflow-y-auto">
              {results.map((r, i) => (
                <button
                  key={`${r.type}-${r.name}-${i}`}
                  onClick={() => handleResultClick(r)}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                >
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${typeBadgeClass[r.type]}`}>
                    {typeLabel[r.type]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-800 truncate">{r.name}</p>
                    {r.sub && <p className="text-[10px] text-gray-400 truncate">{r.sub}</p>}
                  </div>
                  {(r.type === "vm" || r.type === "phys") && (
                    <span className="text-[10px] text-gray-400 shrink-0">Графік →</span>
                  )}
                </button>
              ))}
            </div>
            {(resQ.isLoading || physQ.isLoading) && (
              <p className="text-[10px] text-gray-400 text-center py-1.5 border-t border-gray-100">
                Завантаження...
              </p>
            )}
          </div>
        )}

        {enabled && !open && results.length === 0 && !resQ.isLoading && !physQ.isLoading && (
          <div className="absolute top-full right-0 mt-1 w-64 bg-white rounded-xl shadow-lg border border-gray-200 z-50 px-3 py-3 text-xs text-gray-400">
            Нічого не знайдено
          </div>
        )}
      </div>

      {history?.type === "vm" && (
        <ResourceHistoryModal
          name={history.name}
          onClose={() => setHistory(null)}
        />
      )}
      {history?.type === "phys" && (
        <ResourceHistoryModal
          name={history.name}
          historyFn={(name, days) => api.physicalServerHistory(name, days)}
          onClose={() => setHistory(null)}
          showVCenter={false}
        />
      )}
    </>
  );
}
