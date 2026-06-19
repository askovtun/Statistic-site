import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Comparison from "./pages/Comparison";
import Resources from "./pages/Resources";
import PhysicalServers from "./pages/PhysicalServers";
import Clusters from "./pages/Clusters";
import Problems from "./pages/Problems";

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
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
