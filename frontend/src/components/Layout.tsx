import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import GlobalSearch from "./GlobalSearch";

// ── Nav structure ─────────────────────────────────────────────────────────────

type NavItem = { to: string; label: string; icon: string };
type NavGroup = { id: string; label: string; icon: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    id: "cmdb",
    label: "CMDB & Інвентар",
    icon: "🗃️",
    items: [
      { to: "/comparison",   label: "CMDB vs Zabbix",  icon: "🔍" },
      { to: "/cmdb-vcenter",    label: "CMDB vs vCenter",  icon: "🔎" },
      { to: "/vcenter-new-vms", label: "Нові ВМ з vCenter", icon: "🆕" },
      { to: "/cmdb-stats",      label: "Зміни CMDB",        icon: "📋" },
    ],
  },
  {
    id: "resources",
    label: "Ресурси",
    icon: "💻",
    items: [
      { to: "/resources",       label: "Ресурси ВМ",       icon: "💻" },
      { to: "/physical-servers", label: "Фіз. сервери",     icon: "🗄️" },
      { to: "/clusters",        label: "Кластери",          icon: "🖥️" },
      { to: "/rightsizing",     label: "Rightsizing",       icon: "⚖️" },
      { to: "/disk-analytics",  label: "Диски / Аналітика", icon: "💽" },
      { to: "/disk-forecast",   label: "Диски / Прогноз",   icon: "📈" },
      { to: "/capacity",        label: "Capacity Plan",     icon: "📐" },
    ],
  },
  {
    id: "monitoring",
    label: "Моніторинг",
    icon: "🔔",
    items: [
      { to: "/problems",        label: "Проблеми ВМ",       icon: "⚠️" },
      { to: "/zabbix-problems", label: "Zabbix Проблеми",   icon: "🚨" },
      { to: "/network",         label: "Мережа / Проблеми", icon: "🌐" },
      { to: "/vcenter",         label: "vCenter Health",    icon: "🏥" },
      { to: "/uptime",          label: "Аптайм ВМ",         icon: "⏱️" },
    ],
  },
  {
    id: "security",
    label: "Безпека",
    icon: "🛡️",
    items: [
      { to: "/security",        label: "Безпека",            icon: "🛡️" },
      { to: "/os-report",       label: "Операційні ОС",      icon: "🖥" },
      { to: "/zombie-servers",  label: "Зомбі-сервери",      icon: "💀" },
      { to: "/license-report",  label: "Ліцензії WS",        icon: "🪪" },
    ],
  },
  {
    id: "lifecycle",
    label: "Зміни & Lifecycle",
    icon: "🔄",
    items: [
      { to: "/vm-changes",     label: "Зміни VM",            icon: "🔄" },
      { to: "/decommission",   label: "Виведення ВМ",        icon: "🗑️" },
      { to: "/decommissioned", label: "Виведені з екс.",     icon: "📴" },
    ],
  },
  {
    id: "topology",
    label: "Топологія",
    icon: "🗺️",
    items: [
      { to: "/topology", label: "Топологія", icon: "🗺️" },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSyncedAt(iso: string | null | undefined): string {
  if (!iso) return "ніколи";
  return new Date(iso).toLocaleString("uk-UA");
}

function SyncBadge({ syncedAt }: { syncedAt: string | null | undefined }) {
  if (!syncedAt) {
    return <span className="text-gray-400 dark:text-slate-500">Дані станом на: ніколи</span>;
  }
  const ageH = (Date.now() - new Date(syncedAt).getTime()) / 3_600_000;
  const stale = ageH > 24;
  const label = formatSyncedAt(syncedAt);
  return (
    <span className={stale ? "text-amber-600 dark:text-amber-400 font-medium" : ""}>
      {stale && <span className="mr-1" title="Дані застарілі — більше 24 год. без синхронізації">⚠️</span>}
      Дані станом на: {label}
      {stale && <span className="ml-1 text-amber-500">({Math.floor(ageH)}г тому)</span>}
    </span>
  );
}

function initDark(): boolean {
  const stored = localStorage.getItem("theme");
  if (stored === "dark") return true;
  if (stored === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function loadOpenGroups(): Set<string> {
  try {
    const raw = localStorage.getItem("nav-open-groups");
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* ignore */ }
  return new Set();
}

function saveOpenGroups(s: Set<string>) {
  localStorage.setItem("nav-open-groups", JSON.stringify([...s]));
}

// ── NavGroup component ────────────────────────────────────────────────────────

function NavGroupBlock({
  group,
  open,
  onToggle,
}: {
  group: NavGroup;
  open: boolean;
  onToggle: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <div>
      <button
        onClick={onToggle}
        className={
          "w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold uppercase tracking-wide transition-colors " +
          (open
            ? "text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20"
            : "text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-700 dark:hover:text-slate-200")
        }
      >
        <span className="flex items-center gap-2">
          <span>{group.icon}</span>
          {group.label}
        </span>
        <span className={`text-[10px] transition-transform duration-200 ${open ? "rotate-90" : ""}`}>▶</span>
      </button>

      {/* Animated height */}
      <div
        ref={contentRef}
        style={{
          maxHeight: open ? `${group.items.length * 40}px` : "0px",
          overflow: "hidden",
          transition: "max-height 200ms ease",
        }}
      >
        <div className="ml-2 mt-0.5 space-y-0.5 pb-1">
          {group.items.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                "flex items-center gap-2 pl-4 pr-2 py-1.5 rounded-lg text-sm transition-colors " +
                (isActive
                  ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium"
                  : "text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-900 dark:hover:text-slate-100")
              }
            >
              <span className="text-xs opacity-70">{icon}</span>
              {label}
            </NavLink>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────

export default function Layout() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [polling, setPolling] = useState(false);
  const [dark, setDark] = useState(initDark);

  // Which groups are open (persisted to localStorage)
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const stored = loadOpenGroups();
    // Always open the group that contains the current route
    const activeGroup = NAV_GROUPS.find((g) =>
      g.items.some((i) => i.to === location.pathname)
    );
    if (activeGroup) stored.add(activeGroup.id);
    return stored;
  });

  // When the route changes, ensure the active group stays open
  useEffect(() => {
    const activeGroup = NAV_GROUPS.find((g) =>
      g.items.some((i) => location.pathname === i.to || location.pathname.startsWith(i.to + "/"))
    );
    if (activeGroup) {
      setOpenGroups((prev) => {
        if (prev.has(activeGroup.id)) return prev;
        const next = new Set(prev);
        next.add(activeGroup.id);
        saveOpenGroups(next);
        return next;
      });
    }
  }, [location.pathname]);

  function toggleGroup(id: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveOpenGroups(next);
      return next;
    });
  }

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [dark]);

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
    <div className="flex h-screen bg-gray-50 dark:bg-slate-950 text-gray-900 dark:text-slate-100">
      <aside className="w-56 bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800 flex flex-col shadow-sm flex-shrink-0 print:hidden">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-slate-800">
          <span className="font-bold text-lg text-blue-700 dark:text-blue-400">Statistic-site</span>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">Infrastructure Analytics</p>
        </div>

        <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
          {/* Dashboard — standalone link */}
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors " +
              (isActive
                ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                : "text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-900 dark:hover:text-slate-100")
            }
          >
            <span>📊</span>
            Дашборд
          </NavLink>

          <div className="pt-1 space-y-0.5">
            {NAV_GROUPS.map((group) => (
              <NavGroupBlock
                key={group.id}
                group={group}
                open={openGroups.has(group.id)}
                onToggle={() => toggleGroup(group.id)}
              />
            ))}
          </div>
        </nav>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-end gap-3 px-6 py-2 border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-gray-500 dark:text-slate-400 print:hidden">
          <GlobalSearch />
          <SyncBadge syncedAt={status?.synced_at} />
          <button
            onClick={() => setDark((d) => !d)}
            title={dark ? "Переключити на світлу тему" : "Переключити на темну тему"}
            className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-800 transition text-base"
          >
            {dark ? "☀️" : "🌙"}
          </button>
          <button
            onClick={handleSync}
            disabled={status?.in_progress}
            className="px-3 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status?.in_progress ? "Синхронізація..." : "Оновити дані"}
          </button>
        </div>
        <main className="flex-1 overflow-auto bg-gray-50 dark:bg-slate-950">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
