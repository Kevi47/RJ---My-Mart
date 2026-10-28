import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { changePassword, markDefaultPassword, usingDefaultPassword } from "../lib/staffAuth";
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
  const { profile, stores, store, setStoreId } = useAuth();
  const [pwOpen, setPwOpen] = useState(false);
  const [defaultPw, setDefaultPw] = useState(usingDefaultPassword());
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
            <button className="hidden text-slate-600 hover:underline sm:inline" title="Change password" onClick={() => setPwOpen(true)}>
              {profile?.full_name} <span className="text-xs text-slate-400">({profile?.emp_code} · {profile?.role})</span>
            </button>
            <button className="btn-ghost px-2 py-1" onClick={() => supabase.auth.signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      {defaultPw && (
        <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
          You are using the default password (your employee code).{" "}
          <button className="font-medium underline" onClick={() => setPwOpen(true)}>
            Change it now
          </button>
        </div>
      )}
      {pwOpen && (
        <ChangePassword
          onClose={(changed) => {
            setPwOpen(false);
            if (changed) {
              markDefaultPassword(false);
              setDefaultPw(false);
            }
          }}
        />
      )}
      <main className="mx-auto max-w-7xl px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}

function ChangePassword({ onClose }: { onClose: (changed: boolean) => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    if (pw.length < 4) return setMsg("Use at least 4 characters.");
    if (pw !== pw2) return setMsg("The two passwords do not match.");
    const { error } = await changePassword(pw);
    if (error) return setMsg(error.message);
    onClose(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => onClose(false)}>
      <div className="card w-full max-w-sm space-y-3 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="font-medium">Change password</div>
        <input className="input" type="password" placeholder="New password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <input className="input" type="password" placeholder="Repeat new password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        {msg && <div className="text-sm text-rose-700">{msg}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
