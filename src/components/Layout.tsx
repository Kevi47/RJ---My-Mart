import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";

const links = [
  { to: "/", label: "Invoices", end: true },
  { to: "/invoices/new", label: "New invoice" },
  { to: "/scan", label: "Scan" },
  { to: "/stock", label: "Stock (SOH)" },
  { to: "/audit", label: "Audit log" },
  { to: "/settings", label: "Settings" },
];

export default function Layout() {
  const { profile, stores, store, setStoreId, session } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <div className="flex items-center gap-2 font-semibold text-brand-800">
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            RJ My Mart
          </div>
          <nav className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto text-sm md:order-none md:w-auto">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-md px-2.5 py-1.5 ${isActive ? "bg-brand-50 font-medium text-brand-800" : "text-slate-600 hover:bg-slate-100"}`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm">
            {stores.length > 1 ? (
              <select className="input w-auto py-1" value={store?.id ?? ""} onChange={(e) => setStoreId(e.target.value)}>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-slate-500">{store?.name}</span>
            )}
            <span className="hidden text-slate-400 sm:inline">·</span>
            <span className="hidden text-slate-600 sm:inline" title={session?.user.email}>
              {profile?.full_name} <span className="text-xs text-slate-400">({profile?.role})</span>
            </span>
            <button className="btn-ghost px-2 py-1" onClick={() => supabase.auth.signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}
