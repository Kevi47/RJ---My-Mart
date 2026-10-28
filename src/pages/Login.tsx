import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { createStaffLogin, markDefaultPassword, normaliseCode, signInStaff } from "../lib/staffAuth";

const FIRST_ADMIN = "E9999";

export default function Login() {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [dbMissing, setDbMissing] = useState(false);

  useEffect(() => {
    supabase.rpc("setup_needed").then(({ data, error }) => {
      setSetupNeeded(data === true);
      // The function only exists once supabase/schema.sql has been run
      setDbMissing(Boolean(error));
    });
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await signInStaff(code, password);
    setBusy(false);
    if (error) setMsg(error.message === "Invalid login credentials" ? "Wrong employee code or password." : error.message);
    else markDefaultPassword(normaliseCode(password) === normaliseCode(code));
  }

  async function firstTimeSetup() {
    setBusy(true);
    setMsg(null);
    const { error } = await createStaffLogin(FIRST_ADMIN, "Admin");
    if (error) {
      setBusy(false);
      return setMsg(`${error.message}. In Supabase → Authentication → Sign In / Providers → Email, turn off "Confirm email" and try again.`);
    }
    const { error: signInError } = await signInStaff(FIRST_ADMIN, FIRST_ADMIN);
    setBusy(false);
    if (signInError) setMsg(signInError.message);
    else markDefaultPassword(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
        <div className="flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          <div>
            <div className="font-semibold text-brand-800">RJ My Mart</div>
            <div className="text-xs text-slate-500">Invoice verification & receiving</div>
          </div>
        </div>
        <div>
          <label className="label">Employee code</label>
          <input
            className="input uppercase"
            autoComplete="username"
            autoCapitalize="characters"
            placeholder="e.g. E1001"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {msg && <p className="text-sm text-rose-700">{msg}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Please wait…" : "Sign in"}
        </button>
        <p className="text-center text-xs text-slate-500">New staff accounts are created by the admin. First-time password is your employee code.</p>
        {dbMissing && (
          <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
            The database is not set up yet. In Supabase open <b>SQL Editor → New query</b>, paste the contents of <code>supabase/schema.sql</code>, press{" "}
            <b>Run</b>, then reload this page.
          </div>
        )}
        {setupNeeded && (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            No accounts exist yet.
            <button type="button" className="btn-secondary mt-2 w-full" disabled={busy} onClick={firstTimeSetup}>
              Create admin login {FIRST_ADMIN}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
