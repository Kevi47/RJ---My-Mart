// FR-10 supplier item mapping and FR-3/FR-13 price cross-check.
import { supabase } from "./supabase";
import type { InvoiceLine, Item, PriceFlag, Store } from "./types";
import { effectiveCost, landedCost } from "./validate";

export function normaliseDesc(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const codeKey = (code: string) => `code:${code.trim().toUpperCase()}`;
export const descKey = (desc: string) => `desc:${normaliseDesc(desc)}`;

export interface SearchHit {
  id: string;
  pcode: string;
  name: string;
  mrp: number | null;
  srate: number | null;
  prate: number | null;
  stock: number | null;
  score: number;
}

export async function searchItems(storeId: string, query: string, limit = 8): Promise<SearchHit[]> {
  const { data, error } = await supabase.rpc("search_items", { p_store: storeId, p_query: query, p_limit: limit });
  if (error) throw new Error(error.message);
  return (data as SearchHit[]) ?? [];
}

export async function findOrCreateSupplier(name: string | null, gstin: string | null): Promise<string | null> {
  if (!name && !gstin) return null;
  if (gstin) {
    const { data } = await supabase.from("suppliers").select("id").eq("gstin", gstin).maybeSingle();
    if (data) return data.id;
  } else if (name) {
    const { data } = await supabase.from("suppliers").select("id").ilike("name", name).limit(1).maybeSingle();
    if (data) return data.id;
  }
  const { data, error } = await supabase
    .from("suppliers")
    .insert({ name: name ?? gstin, gstin })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export interface MatchResult {
  item_id: string | null;
  match_source: string | null;
  units_per_case?: number | null;
  score?: number;
}

/** Learned mapping first (code, then description), then fuzzy search as a suggestion. */
export async function matchLines(
  storeId: string,
  supplierId: string | null,
  lines: { item_code: string | null; description: string }[],
): Promise<MatchResult[]> {
  const maps = new Map<string, { item_id: string; units_per_case: number | null }>();
  if (supplierId) {
    const { data } = await supabase
      .from("supplier_item_map")
      .select("match_key,item_id,units_per_case")
      .eq("supplier_id", supplierId)
      .eq("store_id", storeId);
    for (const m of data ?? []) maps.set(m.match_key, m);
  }
  return Promise.all(
    lines.map(async (l): Promise<MatchResult> => {
      const byCode = l.item_code ? maps.get(codeKey(l.item_code)) : undefined;
      if (byCode) return { item_id: byCode.item_id, match_source: "map_code", units_per_case: byCode.units_per_case };
      const byDesc = maps.get(descKey(l.description));
      if (byDesc) return { item_id: byDesc.item_id, match_source: "map_desc", units_per_case: byDesc.units_per_case };
      try {
        const hits = await searchItems(storeId, l.description, 2);
        const [top, next] = hits;
        if (top && top.score >= 0.45 && (!next || top.score - next.score >= 0.05)) {
          return { item_id: top.id, match_source: "fuzzy", score: top.score };
        }
      } catch {
        /* search unavailable — leave unmatched */
      }
      return { item_id: null, match_source: null };
    }),
  );
}

/** Persist a confirmed link so the line matches automatically next time. */
export async function learnMapping(
  storeId: string,
  supplierId: string | null,
  line: Pick<InvoiceLine, "item_code" | "description" | "units_per_case">,
  itemId: string,
) {
  if (!supplierId) return;
  const rows = [{ match_key: descKey(line.description) }];
  if (line.item_code) rows.push({ match_key: codeKey(line.item_code) });
  await supabase.from("supplier_item_map").upsert(
    rows.map((r) => ({
      ...r,
      supplier_id: supplierId,
      store_id: storeId,
      item_id: itemId,
      units_per_case: line.units_per_case,
    })),
    { onConflict: "supplier_id,store_id,match_key" },
  );
}

export interface PriceCheck {
  flag: PriceFlag;
  notes: string[];
  effCost: number | null;
  landed: number | null;
  marginPct: number | null;
  baselineMrp: number | null;
  invoiceMrp: number | null;
}

/** FR-3 / FR-13: compare an invoice line to the SOH baseline. */
export function priceCheck(line: InvoiceLine, item: Item | undefined, store: Store | null): PriceCheck {
  const notes: string[] = [];
  const effCost = effectiveCost(line);
  const landed = landedCost(line);
  const invoiceMrp = line.pack_mrp ?? line.mrp;
  if (!item) return { flag: "new_item", notes: ["Not found in SOH"], effCost, landed, marginPct: null, baselineMrp: null, invoiceMrp };

  const flags = new Set<PriceFlag>();
  const baselineMrp = item.mrp;

  if (invoiceMrp != null && baselineMrp != null && Math.abs(invoiceMrp - baselineMrp) > 0.009) {
    flags.add("mrp_changed");
    notes.push(`MRP ₹${baselineMrp} → ₹${invoiceMrp}`);
  }
  if (invoiceMrp == null) notes.push("No MRP on invoice — confirm pack MRP");
  if (invoiceMrp != null && item.srate != null && item.srate > invoiceMrp + 0.009) {
    flags.add("sale_price_changed");
    notes.push(`Sale price ₹${item.srate} is above MRP ₹${invoiceMrp}`);
  }
  if (baselineMrp == null && invoiceMrp != null && item.srate != null && Math.abs(item.srate - invoiceMrp) > 0.009) {
    notes.push(`SOH has no MRP; sale price ₹${item.srate} vs invoice MRP ₹${invoiceMrp}`);
  }

  const tol = (store?.cost_tolerance_pct ?? 1) / 100;
  if (effCost != null && item.prate) {
    const near = (a: number) => Math.abs(a - item.prate!) <= item.prate! * tol + 0.01;
    if (!near(effCost) && !(landed != null && near(landed))) {
      flags.add("cost_changed");
      notes.push(`Cost ₹${item.prate.toFixed(2)} → ₹${effCost.toFixed(2)} (${effCost > item.prate ? "+" : ""}${(((effCost - item.prate) / item.prate) * 100).toFixed(1)}%)`);
    }
  }

  let marginPct: number | null = null;
  if (landed != null && item.srate) {
    marginPct = ((item.srate - landed) / item.srate) * 100;
    if (item.srate < landed) {
      flags.add("sale_price_changed");
      notes.push(`Sale price ₹${item.srate} is below new cost ₹${landed.toFixed(2)}`);
    } else if (marginPct < (store?.margin_threshold ?? 8)) {
      notes.push(`Low margin ${marginPct.toFixed(1)}%`);
    }
  }

  const order: PriceFlag[] = ["mrp_changed", "sale_price_changed", "cost_changed"];
  const flag = order.find((f) => flags.has(f)) ?? "ok";
  return { flag, notes, effCost, landed, marginPct, baselineMrp, invoiceMrp };
}

export const FLAG_LABEL: Record<PriceFlag, string> = {
  ok: "No change",
  mrp_changed: "MRP changed",
  sale_price_changed: "Sale price issue",
  cost_changed: "Cost changed",
  new_item: "New item",
};

export const FLAG_STYLE: Record<PriceFlag, string> = {
  ok: "bg-emerald-100 text-emerald-800",
  mrp_changed: "bg-amber-100 text-amber-900",
  sale_price_changed: "bg-rose-100 text-rose-800",
  cost_changed: "bg-sky-100 text-sky-800",
  new_item: "bg-violet-100 text-violet-800",
};
