// FR-9 arithmetic checks and FR-11 unit/effective-cost normalisation.
import type { HeaderValidation } from "./types";

export interface LineNumbers {
  qty: number;
  free_qty?: number | null;
  cases?: number | null;
  pieces?: number | null;
  units_per_case?: number | null;
  rate?: number | null;
  gross?: number | null;
  discount_pct?: number | null;
  discount_amt?: number | null;
  scheme_amt?: number | null;
  taxable?: number | null;
  gst_pct?: number | null;
  tax_amt?: number | null;
  total?: number | null;
  hsn?: string | null;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
const close = (a: number, b: number, abs = 1, rel = 0.005) => Math.abs(a - b) <= Math.max(abs, Math.abs(b) * rel);
const fmt = (n: number) => n.toFixed(2);

/** Sum of discounts in rupees for a line. */
export function lineDiscount(l: LineNumbers): number {
  const gross = l.gross ?? (l.rate != null ? l.qty * l.rate : 0);
  const pct = l.discount_amt == null && l.discount_pct ? (gross * l.discount_pct) / 100 : 0;
  return (l.discount_amt ?? 0) + (l.scheme_amt ?? 0) + pct;
}

/** Taxable value — printed if present, else derived. */
export function lineTaxable(l: LineNumbers): number | null {
  if (l.taxable != null) return l.taxable;
  const gross = l.gross ?? (l.rate != null ? l.qty * l.rate : null);
  return gross == null ? null : gross - lineDiscount(l);
}

export function lineTotal(l: LineNumbers): number | null {
  if (l.total != null) return l.total;
  const taxable = lineTaxable(l);
  if (taxable == null) return null;
  return taxable + (l.tax_amt ?? (taxable * (l.gst_pct ?? 0)) / 100);
}

/** Cost per piece after discount/scheme, before GST (FR-11). Free units dilute cost. */
export function effectiveCost(l: LineNumbers): number | null {
  const taxable = lineTaxable(l);
  const units = l.qty + (l.free_qty ?? 0);
  return taxable == null || units <= 0 ? null : taxable / units;
}

/** Cost per piece including GST — what the sale price must cover. */
export function landedCost(l: LineNumbers): number | null {
  const c = effectiveCost(l);
  return c == null ? null : c * (1 + (l.gst_pct ?? 0) / 100);
}

export function lookupHsnRate(hsn: string | null | undefined, rates: Map<string, number>): number | undefined {
  if (!hsn) return undefined;
  const h = hsn.replace(/\D/g, "");
  for (const len of [8, 6, 4]) {
    const r = rates.get(h.slice(0, len));
    if (r != null && h.length >= len) return r;
  }
  return undefined;
}

export function validateLine(l: LineNumbers, hsnRates: Map<string, number>): string[] {
  const w: string[] = [];

  if (l.cases != null && l.units_per_case) {
    const expected = l.cases * l.units_per_case + (l.pieces ?? 0);
    if (expected !== l.qty) w.push(`Qty ${l.qty} ≠ ${l.cases} cs × ${l.units_per_case} + ${l.pieces ?? 0} pcs = ${expected}`);
  }
  if (!l.qty || l.qty <= 0) {
    if (l.gross != null && l.rate) w.push(`Qty missing — gross ÷ rate suggests ${round2(l.gross / l.rate)}`);
    else w.push("Qty missing");
  }
  if (l.rate != null && l.gross != null && l.qty > 0 && !close(l.qty * l.rate, l.gross)) {
    const derived = round2(l.gross / l.rate);
    w.push(`Qty × rate = ${fmt(l.qty * l.rate)} but gross is ${fmt(l.gross)} (gross ÷ rate = ${derived} pcs)`);
  }
  if (l.taxable != null) {
    const gross = l.gross ?? (l.rate != null ? l.qty * l.rate : null);
    if (gross != null) {
      const expected = gross - lineDiscount({ ...l, taxable: null });
      if (!close(expected, l.taxable)) w.push(`Gross − discount = ${fmt(expected)} but taxable is ${fmt(l.taxable)}`);
    }
  }
  const taxable = lineTaxable(l);
  if (taxable != null && l.gst_pct != null && l.tax_amt != null) {
    const expected = (taxable * l.gst_pct) / 100;
    if (!close(expected, l.tax_amt, 0.5)) w.push(`Taxable × ${l.gst_pct}% = ${fmt(expected)} but tax is ${fmt(l.tax_amt)}`);
  }
  if (taxable != null && l.total != null) {
    const expected = taxable + (l.tax_amt ?? (taxable * (l.gst_pct ?? 0)) / 100);
    if (!close(expected, l.total)) w.push(`Taxable + tax = ${fmt(expected)} but line total is ${fmt(l.total)}`);
  }
  const hsnRate = lookupHsnRate(l.hsn, hsnRates);
  if (hsnRate != null && l.gst_pct != null && hsnRate !== l.gst_pct) {
    w.push(`GST ${l.gst_pct}% differs from ${hsnRate}% previously used for HSN ${l.hsn}`);
  }
  return w;
}

export function validateHeader(
  lines: LineNumbers[],
  header: { invoice_total: number | null; round_off: number | null },
): HeaderValidation {
  const messages: string[] = [];
  let sum = 0;
  let missing = 0;
  for (const l of lines) {
    const t = lineTotal(l);
    if (t == null) missing++;
    else sum += t;
  }
  if (missing) messages.push(`${missing} line(s) have no amount — total check is partial`);
  const expected = header.invoice_total;
  const withRound = sum + (header.round_off ?? 0);
  const difference = expected == null ? null : round2(expected - withRound);
  const ok = expected != null && Math.abs(difference!) <= 2;
  if (expected == null) messages.push("Invoice total not captured");
  else if (!ok) messages.push(`Lines add up to ₹${fmt(withRound)} but invoice total is ₹${fmt(expected)} (diff ₹${fmt(difference!)})`);
  return { lines_sum: round2(sum), expected_total: expected, difference, ok, messages };
}
