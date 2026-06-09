import { NavLink, Outlet } from "react-router-dom";

const navItems = [
  { to: "/", label: "Дашборд", icon: "📊" },
  { to: "/comparison", label: "CMDB vs Zabbix", icon: "🔍" },
  { to: "/resources", label: "Ресурси ВМ", icon: "💻" },
  { to: "/clusters", label: "Кластери", icon: "🖥️" },
];

export default function Layout() {
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
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
