// Runs FR-3, FR-9 and FR-13 for every line and writes back the flag + warnings.
import { supabase } from "./supabase";
import type { InvoiceLine, Item, PriceFlag, Store } from "./types";
import { priceCheck } from "./match";
import { validateLine } from "./validate";

let hsnCache: { at: number; rates: Map<string, number> } | null = null;

export async function loadHsnRates(): Promise<Map<string, number>> {
  if (hsnCache && Date.now() - hsnCache.at < 60_000) return hsnCache.rates;
  const { data } = await supabase.from("hsn_rates").select("hsn,gst_pct");
  const rates = new Map((data ?? []).map((r) => [r.hsn as string, Number(r.gst_pct)]));
  hsnCache = { at: Date.now(), rates };
  return rates;
}

export function checkLine(line: InvoiceLine, item: Item | undefined, store: Store | null, hsnRates: Map<string, number>) {
  const pc = priceCheck(line, item, store);
  const warnings = [...validateLine(line, hsnRates), ...pc.notes];
  if (line.match_source === "fuzzy") warnings.unshift("Matched by name — confirm the item");
  return { price_flag: pc.flag as PriceFlag, warnings };
}

/** Recompute and persist checks for the given lines; returns the updated lines. */
export async function runChecks(lines: InvoiceLine[], items: Map<string, Item>, store: Store | null): Promise<InvoiceLine[]> {
  const rates = await loadHsnRates();
  const updated = lines.map((l) => ({ ...l, ...checkLine(l, l.item_id ? items.get(l.item_id) : undefined, store, rates) }));
  const changed = updated.filter((u, i) => u.price_flag !== lines[i].price_flag || JSON.stringify(u.warnings) !== JSON.stringify(lines[i].warnings));
  await Promise.all(
    changed.map((u) => supabase.from("invoice_lines").update({ price_flag: u.price_flag, warnings: u.warnings }).eq("id", u.id)),
  );
  return updated;
}
