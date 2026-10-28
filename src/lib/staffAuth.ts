// Staff sign in with an employee code (e.g. E9999). Supabase Auth needs an email and a
// 6+ character password, so the code maps to an internal address and the password gets
// a fixed prefix. Staff only ever see their code and their own password.
import { createClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";

const DOMAIN = "staff.rjmymart.local";

export const normaliseCode = (code: string) => code.trim().toUpperCase();

export function loginEmail(idOrEmail: string): string {
  const v = idOrEmail.trim();
  return v.includes("@") ? v.toLowerCase() : `${normaliseCode(v).toLowerCase()}@${DOMAIN}`;
}

export const authPassword = (password: string) => `rjmm:${password}`;

export async function signInStaff(code: string, password: string) {
  return supabase.auth.signInWithPassword({ email: loginEmail(code), password: authPassword(password) });
}

export async function changePassword(newPassword: string) {
  return supabase.auth.updateUser({ password: authPassword(newPassword) });
}

/** Creates a staff login without replacing the admin's own session. Default password = code. */
export async function createStaffLogin(code: string, fullName: string) {
  const temp = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: "rj-staff-signup" },
  });
  const empCode = normaliseCode(code);
  return temp.auth.signUp({
    email: loginEmail(empCode),
    password: authPassword(empCode),
    options: { data: { emp_code: empCode, full_name: fullName } },
  });
}

const DEFAULT_PW_KEY = "rj.defaultPassword";
export function markDefaultPassword(isDefault: boolean) {
  try {
    if (isDefault) sessionStorage.setItem(DEFAULT_PW_KEY, "1");
    else sessionStorage.removeItem(DEFAULT_PW_KEY);
  } catch {
    /* storage blocked */
  }
}
export function usingDefaultPassword() {
  try {
    return sessionStorage.getItem(DEFAULT_PW_KEY) === "1";
  } catch {
    return false;
  }
}
