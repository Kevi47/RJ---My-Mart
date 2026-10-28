import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
    setBusy(false);
    if (error) setMsg(error.message);
    else if (mode === "signup") setMsg("Account created. If email confirmation is on, confirm your email, then sign in.");
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
        {mode === "signup" && (
          <div>
            <label className="label">Your name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
        )}
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label">Password</label>
          <input
            className="input"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {msg && <p className="text-sm text-rose-700">{msg}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
        <button type="button" className="w-full text-center text-xs text-slate-500 underline" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
          {mode === "signin" ? "New staff member? Create an account" : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
