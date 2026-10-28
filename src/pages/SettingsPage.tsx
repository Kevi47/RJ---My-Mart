import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { audit, supabase } from "../lib/supabase";
import type { Profile, Role } from "../lib/types";
import NumInput from "../components/NumInput";
import { createStaffLogin, normaliseCode } from "../lib/staffAuth";

export default function SettingsPage() {
  const { store, stores, profile, reloadStores, isManager } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [newStore, setNewStore] = useState("");
  const [staff, setStaff] = useState({ code: "", name: "", role: "clerk" as Role });
  const [staffMsg, setStaffMsg] = useState<string | null>(null);
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

  /** New staff log in with their employee code; first password = the code. */
  async function addStaff() {
    const code = normaliseCode(staff.code);
    if (!/^[A-Z0-9-]{2,20}$/.test(code) || !staff.name.trim()) return setStaffMsg("Enter an employee code (letters/digits) and a name.");
    setStaffMsg("Creating…");
    const { data, error } = await createStaffLogin(code, staff.name.trim());
    if (error || !data.user) return setStaffMsg(error?.message ?? "Could not create the login.");
    const { error: pErr } = await supabase
      .from("profiles")
      .update({ active: true, role: staff.role, store_id: store?.id ?? null, emp_code: code, full_name: staff.name.trim() })
      .eq("id", data.user.id);
    if (pErr) return setStaffMsg(pErr.message);
    await audit("staff_created", "profile", data.user.id, { emp_code: code, role: staff.role });
    setStaff({ code: "", name: "", role: "clerk" });
    setStaffMsg(`Created ${code}. First-time password: ${code}`);
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
          Staff sign in with their employee code; the first password is the code itself, and they can change it from the header. Managers approve
          reconciliations; admins also manage staff. To reset a forgotten password, delete the user in Supabase → Authentication and add them again here.
        </p>
        {isAdmin && (
          <div className="mb-4 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-[120px_1fr_130px_auto]">
            <input className="input uppercase" placeholder="Emp code" value={staff.code} onChange={(e) => setStaff({ ...staff, code: e.target.value })} />
            <input className="input" placeholder="Full name" value={staff.name} onChange={(e) => setStaff({ ...staff, name: e.target.value })} />
            <select className="input" value={staff.role} onChange={(e) => setStaff({ ...staff, role: e.target.value as Role })}>
              <option value="clerk">Clerk</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
            <button className="btn-primary" onClick={addStaff}>
              Add staff
            </button>
            {staffMsg && <div className="text-sm text-slate-700 sm:col-span-4">{staffMsg}</div>}
          </div>
        )}
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Code</th>
              <th className="th">Name</th>
              <th className="th">Role</th>
              <th className="th">Home store</th>
              <th className="th">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="td font-mono">{u.emp_code}</td>
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
