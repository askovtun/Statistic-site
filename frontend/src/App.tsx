import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Comparison from "./pages/Comparison";
import Resources from "./pages/Resources";
import PhysicalServers from "./pages/PhysicalServers";
import Clusters from "./pages/Clusters";
import Problems from "./pages/Problems";
import VCenter from "./pages/VCenter";
import ZabbixProblems from "./pages/ZabbixProblems";
import OsReport from "./pages/OsReport";
import CmdbStats from "./pages/CmdbStats";
import UptimeReport from "./pages/UptimeReport";
import DecommissionPage from "./pages/DecommissionPage";
import DecommissionedPage from "./pages/DecommissionedPage";
import CapacityPlanning from "./pages/CapacityPlanning";
import SecurityDashboard from "./pages/SecurityDashboard";
import VmChanges from "./pages/VmChanges";
import TopologyMap from "./pages/TopologyMap";
import CmdbVcenter from "./pages/CmdbVcenter";
import ZombieServers from "./pages/ZombieServers";
import RightsizingPage from "./pages/RightsizingPage";
import DiskForecastPage from "./pages/DiskForecastPage";
import DiskAnalyticsPage from "./pages/DiskAnalyticsPage";
import NetworkPage from "./pages/NetworkPage";
import VCenterNewVMs from "./pages/VCenterNewVMs";
import LicenseReport from "./pages/LicenseReport";
import VmMigrations from "./pages/VmMigrations";
import MonitoringCoverage from "./pages/MonitoringCoverage";
import VulnScanner from "./pages/VulnScanner";
import VmSnapshots from "./pages/VmSnapshots";
import ZabbixTrends from "./pages/ZabbixTrends";
import CmdbCompleteness from "./pages/CmdbCompleteness";
import PowerStatePage from "./pages/PowerStatePage";
import InfraGrowth from "./pages/InfraGrowth";
import VmAge from "./pages/VmAge";
import HostDistribution from "./pages/HostDistribution";
import ApplicationsPage from "./pages/ApplicationsPage";
import NetworkInventory from "./pages/NetworkInventory";
import ServerRoomsPage from "./pages/ServerRoomsPage";
import BackupCoverage from "./pages/BackupCoverage";
import DatastoresPage from "./pages/DatastoresPage";
import JiraCiLinks from "./pages/JiraCiLinks";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="comparison" element={<Comparison />} />
            <Route path="resources" element={<Resources />} />
            <Route path="physical-servers" element={<PhysicalServers />} />
            <Route path="clusters" element={<Clusters />} />
            <Route path="problems" element={<Problems />} />
            <Route path="vcenter" element={<VCenter />} />
            <Route path="zabbix-problems" element={<ZabbixProblems />} />
            <Route path="os-report" element={<OsReport />} />
            <Route path="cmdb-stats" element={<CmdbStats />} />
            <Route path="uptime" element={<UptimeReport />} />
            <Route path="decommission" element={<DecommissionPage />} />
            <Route path="decommissioned" element={<DecommissionedPage />} />
            <Route path="capacity" element={<CapacityPlanning />} />
            <Route path="security" element={<SecurityDashboard />} />
            <Route path="vm-changes" element={<VmChanges />} />
            <Route path="topology" element={<TopologyMap />} />
            <Route path="cmdb-vcenter" element={<CmdbVcenter />} />
            <Route path="zombie-servers" element={<ZombieServers />} />
            <Route path="rightsizing"    element={<RightsizingPage />} />
            <Route path="disk-forecast"   element={<DiskForecastPage />} />
            <Route path="disk-analytics"  element={<DiskAnalyticsPage />} />
            <Route path="network"         element={<NetworkPage />} />
            <Route path="vcenter-new-vms" element={<VCenterNewVMs />} />
            <Route path="license-report"  element={<LicenseReport />} />
            <Route path="vm-migrations"  element={<VmMigrations />} />
            <Route path="monitoring-coverage" element={<MonitoringCoverage />} />
            <Route path="vuln-scanner" element={<VulnScanner />} />
            <Route path="vm-snapshots" element={<VmSnapshots />} />
            <Route path="zabbix-trends" element={<ZabbixTrends />} />
            <Route path="cmdb-completeness" element={<CmdbCompleteness />} />
            <Route path="power-state" element={<PowerStatePage />} />
            <Route path="infra-growth" element={<InfraGrowth />} />
            <Route path="vm-age" element={<VmAge />} />
            <Route path="host-distribution" element={<HostDistribution />} />
            <Route path="applications" element={<ApplicationsPage />} />
            <Route path="network-inventory" element={<NetworkInventory />} />
            <Route path="server-rooms" element={<ServerRoomsPage />} />
            <Route path="backup-coverage" element={<BackupCoverage />} />
            <Route path="datastores" element={<DatastoresPage />} />
            <Route path="jira-ci-links" element={<JiraCiLinks />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
