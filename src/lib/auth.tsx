import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Profile, Store } from "./types";

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  stores: Store[];
  store: Store | null;
  setStoreId: (id: string) => void;
  reloadStores: () => Promise<void>;
  loading: boolean;
  isManager: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

const STORE_KEY = "rj.storeId";

function readStoredStore(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreIdState] = useState<string | null>(readStoredStore());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function reloadStores() {
    const { data } = await supabase.from("stores").select("*").order("created_at");
    setStores((data as Store[]) ?? []);
  }

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    (async () => {
      const [{ data: p }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle(),
        reloadStores(),
      ]);
      setProfile(p as Profile | null);
      setLoading(false);
    })();
  }, [session?.user.id]);

  const store = stores.find((s) => s.id === storeId) ?? stores.find((s) => s.id === profile?.store_id) ?? stores[0] ?? null;

  function setStoreId(id: string) {
    setStoreIdState(id);
    try {
      localStorage.setItem(STORE_KEY, id);
    } catch {
      /* private mode */
    }
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        stores,
        store,
        setStoreId,
        reloadStores,
        loading,
        isManager: profile?.role === "manager" || profile?.role === "admin",
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
