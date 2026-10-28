import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { audit, supabase } from "../lib/supabase";
import type { Profile, Role } from "../lib/types";
import NumInput from "../components/NumInput";

export default function SettingsPage() {
  const { store, stores, profile, reloadStores, isManager } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [newStore, setNewStore] = useState("");
  const isAdmin = profile?.role === "admin";

  async function loadUsers() {
    const { data } = await supabase.from("profiles").select("*").order("created_at");
    setUsers((data as Profile[]) ?? []);
  }
  useEffect(() => {
    void loadUsers();
  }, []);

  async function updateStore(patch: Record<string, unknown>) {
    if (!store) return;
    await supabase.from("stores").update(patch).eq("id", store.id);
    await audit("store_settings_changed", "store", store.id, patch);
    await reloadStores();
  }

  async function updateUser(u: Profile, patch: Partial<Profile>) {
    const { error } = await supabase.from("profiles").update(patch).eq("id", u.id);
    if (error) return alert(error.message);
    await audit("user_changed", "profile", u.id, patch);
    await loadUsers();
  }

  async function addStore() {
    if (!newStore.trim()) return;
    const { error } = await supabase.from("stores").insert({ name: newStore.trim(), gstin: store?.gstin });
    if (error) return alert(error.message);
    setNewStore("");
    await reloadStores();
  }

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      {store && (
        <div className="card space-y-3 p-4">
          <div className="font-medium">Store: {store.name}</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label">GSTIN</label>
              <input className="input" defaultValue={store.gstin ?? ""} disabled={!isManager} onBlur={(e) => updateStore({ gstin: e.target.value || null })} />
            </div>
            <div>
              <label className="label">Low-margin alert below (%)</label>
              <NumInput value={store.margin_threshold} disabled={!isManager} onCommit={(v) => updateStore({ margin_threshold: v ?? 0 })} className="py-2 text-left" />
            </div>
            <div>
              <label className="label">Flag cost change above (%)</label>
              <NumInput value={store.cost_tolerance_pct} disabled={!isManager} onCommit={(v) => updateStore({ cost_tolerance_pct: v ?? 0 })} className="py-2 text-left" />
            </div>
          </div>
          {isAdmin && (
            <div className="flex gap-2 border-t border-slate-100 pt-3">
              <input className="input" placeholder="Add another store (e.g. Thrippunithura)" value={newStore} onChange={(e) => setNewStore(e.target.value)} />
              <button className="btn-secondary" onClick={addStore}>
                Add store
              </button>
            </div>
          )}
        </div>
      )}

      <div className="card p-4">
        <div className="mb-1 font-medium">Staff</div>
        <p className="mb-3 text-sm text-slate-600">
          Staff create their own account on the sign-in page; an admin activates it here. Managers can approve reconciliations; admins also manage staff.
        </p>
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Name</th>
              <th className="th">Role</th>
              <th className="th">Home store</th>
              <th className="th">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="td">
                  {u.full_name}
                  {u.id === profile?.id && <span className="text-xs text-slate-400"> (you)</span>}
                </td>
                <td className="td">
                  <select
                    className="input py-1"
                    value={u.role}
                    disabled={!isAdmin || u.id === profile?.id}
                    onChange={(e) => updateUser(u, { role: e.target.value as Role })}
                  >
                    <option value="clerk">Clerk</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td className="td">
                  <select className="input py-1" value={u.store_id ?? ""} disabled={!isAdmin} onChange={(e) => updateUser(u, { store_id: e.target.value || null })}>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="td">
                  <input type="checkbox" checked={u.active} disabled={!isAdmin || u.id === profile?.id} onChange={(e) => updateUser(u, { active: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
