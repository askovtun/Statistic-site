import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import GlobalSearch from "./GlobalSearch";

const navItems = [
  { to: "/", label: "Дашборд", icon: "📊" },
  { to: "/comparison", label: "CMDB vs Zabbix", icon: "🔍" },
  { to: "/resources", label: "Ресурси ВМ", icon: "💻" },
  { to: "/physical-servers", label: "Фіз. сервери", icon: "🗄️" },
  { to: "/clusters", label: "Кластери", icon: "🖥️" },
  { to: "/problems", label: "Проблеми", icon: "⚠️" },
];

function formatSyncedAt(iso: string | null | undefined): string {
  if (!iso) return "ніколи";
  return new Date(iso).toLocaleString("uk-UA");
}

export default function Layout() {
  const queryClient = useQueryClient();
  const [polling, setPolling] = useState(false);

  const { data: status } = useQuery({
    queryKey: ["sync-status"],
    queryFn: api.syncStatus,
    refetchInterval: polling ? 3000 : false,
  });

  useEffect(() => {
    if (!status) return;
    if (status.in_progress) {
      setPolling(true);
    } else if (polling) {
      setPolling(false);
      queryClient.invalidateQueries();
    }
  }, [status, polling, queryClient]);

  const handleSync = async () => {
    await api.triggerSync();
    setPolling(true);
    queryClient.invalidateQueries({ queryKey: ["sync-status"] });
  };

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900">
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col shadow-sm">
        <div className="px-5 py-4 border-b border-gray-200">
          <span className="font-bold text-lg text-blue-700">Statistic-site</span>
          <p className="text-xs text-gray-400 mt-0.5">Infrastructure Analytics</p>
        </div>
        <nav className="flex-1 py-3 px-2 space-y-1">
          {navItems.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ` +
                (isActive
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900")
              }
            >
              <span>{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-end gap-3 px-6 py-2 border-b border-gray-200 bg-white text-xs text-gray-500">
          <GlobalSearch />
          <span>Дані станом на: {formatSyncedAt(status?.synced_at)}</span>
          <button
            onClick={handleSync}
            disabled={status?.in_progress}
            className="px-3 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status?.in_progress ? "Синхронізація..." : "Оновити дані"}
          </button>
        </div>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
