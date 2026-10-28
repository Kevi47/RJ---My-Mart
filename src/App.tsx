import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { supabase, supabaseConfigured } from "./lib/supabase";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
const NewInvoice = lazy(() => import("./pages/NewInvoice"));
const InvoicePage = lazy(() => import("./pages/InvoicePage"));
const ScanPage = lazy(() => import("./pages/ScanPage"));
const ScanPicker = lazy(() => import("./pages/ScanPicker"));
const StockPage = lazy(() => import("./pages/StockPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const AuditPage = lazy(() => import("./pages/AuditPage"));

export default function App() {
  const { session, profile, loading } = useAuth();

  if (!supabaseConfigured) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <h1 className="text-xl font-semibold">Setup needed</h1>
        <p className="mt-2 text-sm text-slate-600">
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in the environment (see <code>.env.example</code>), then rebuild.
        </p>
      </div>
    );
  }
  if (loading) return <div className="p-8 text-sm text-slate-500">Loading…</div>;
  if (!session) return <Login />;
  if (profile && !profile.active) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Waiting for activation</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your login ({profile.emp_code}) exists but is not active. Ask the store admin to activate it in Settings.
        </p>
        <button className="btn-secondary mt-6" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-500">Loading…</div>}>
    <Routes>
      <Route path="/scan/:id" element={<ScanPage />} />
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="/invoices/new" element={<NewInvoice />} />
        <Route path="/invoices/:id" element={<InvoicePage />} />
        <Route path="/scan" element={<ScanPicker />} />
        <Route path="/stock" element={<StockPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
