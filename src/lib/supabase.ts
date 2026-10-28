import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key);

export const supabase = createClient(url ?? "http://localhost", key ?? "missing", {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 20 } },
});

export async function audit(action: string, entity: string, entityId: string | null, details?: unknown) {
  await supabase.from("audit_log").insert({ action, entity, entity_id: entityId, details: details ?? null });
}

/** Supabase caps a select at 1000 rows; page through for bigger tables. */
export async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) return out;
  }
}
