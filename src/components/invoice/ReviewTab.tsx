import { useState } from "react";
import { audit, supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import type { InvoiceLine, Item } from "../../lib/types";
import type { InvoiceData } from "../../lib/useInvoice";
import { checkLine, loadHsnRates, runChecks } from "../../lib/checks";
import { FLAG_LABEL, FLAG_STYLE, learnMapping, type SearchHit } from "../../lib/match";
import { effectiveCost, landedCost } from "../../lib/validate";
import { inr } from "../../lib/util";
import NumInput from "../NumInput";
import ItemPicker from "../ItemPicker";

type NumField =
  | "qty"
  | "free_qty"
  | "mrp"
  | "pack_mrp"
  | "rate"
  | "discount_pct"
  | "discount_amt"
  | "scheme_amt"
  | "taxable"
  | "gst_pct"
  | "tax_amt"
  | "total"
  | "units_per_case";

export default function ReviewTab({ data, editable }: { data: InvoiceData; editable: boolean }) {
  const { store } = useAuth();
  const { invoice, lines, items, setLines, setItems } = data;
  const [picker, setPicker] = useState<InvoiceLine | null>(null);
  const [busy, setBusy] = useState(false);

  async function patchLine(line: InvoiceLine, patch: Partial<InvoiceLine>, itemOverride?: Item) {
    const next = { ...line, ...patch };
    if (patch.qty !== undefined || patch.rate !== undefined) next.gross = next.rate != null ? next.qty * next.rate : next.gross;
    const rates = await loadHsnRates();
    const item = itemOverride ?? (next.item_id ? items.get(next.item_id) : undefined);
    Object.assign(next, checkLine(next, item, store, rates));
    setLines((prev) => prev.map((l) => (l.id === line.id ? next : l)));
    const { id: _id, ...row } = next;
    void _id;
    await supabase.from("invoice_lines").update(row).eq("id", line.id);
  }

  async function pickItem(line: InvoiceLine, hit: SearchHit) {
    setPicker(null);
    const { data: item } = await supabase.from("items").select("*").eq("id", hit.id).single();
    if (!item) return;
    setItems((prev) => new Map(prev).set(item.id, item as Item));
    await patchLine(line, { item_id: item.id, match_source: "manual" }, item as Item);
    await learnMapping(store!.id, invoice!.supplier_id, line, item.id);
    await audit("line_matched", "invoice_line", line.id, { item: item.pcode, description: line.description });
  }

  async function confirmMatch(line: InvoiceLine) {
    if (!line.item_id) return;
    await patchLine(line, { match_source: "manual" });
    await learnMapping(store!.id, invoice!.supplier_id, line, line.item_id);
  }

  async function addLine() {
    const { data: row } = await supabase
      .from("invoice_lines")
      .insert({ invoice_id: invoice!.id, line_no: (lines.at(-1)?.line_no ?? 0) + 1, description: "New line", qty: 0 })
      .select("*")
      .single();
    if (row) setLines((prev) => [...prev, row as InvoiceLine]);
  }

  async function deleteLine(line: InvoiceLine) {
    if (!confirm(`Delete line ${line.line_no} (${line.description})?`)) return;
    await supabase.from("invoice_lines").delete().eq("id", line.id);
    setLines((prev) => prev.filter((l) => l.id !== line.id));
  }

  async function recheckAll() {
    setBusy(true);
    setLines(await runChecks(lines, items, store));
    setBusy(false);
  }

  const num = (line: InvoiceLine, f: NumField, opts: { highlight?: boolean; placeholder?: string } = {}) => (
    <NumInput
      value={line[f] as number | null}
      disabled={!editable}
      highlight={opts.highlight}
      placeholder={opts.placeholder}
      onCommit={(v) => patchLine(line, { [f]: f === "qty" || f === "free_qty" ? (v ?? 0) : v })}
    />
  );

  const unmatched = lines.filter((l) => !l.item_id).length;
  const flagged = lines.filter((l) => l.price_flag && l.price_flag !== "ok").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="badge bg-slate-100 text-slate-700">{lines.length} lines</span>
        {unmatched > 0 && <span className="badge bg-violet-100 text-violet-800">{unmatched} not matched to stock</span>}
        {flagged > 0 && <span className="badge bg-amber-100 text-amber-900">{flagged} price flags</span>}
        <div className="ml-auto flex gap-2">
          {editable && (
            <button className="btn-secondary" onClick={addLine}>
              + Add line
            </button>
          )}
          <button className="btn-secondary" onClick={recheckAll} disabled={busy}>
            {busy ? "Checking…" : "Re-run checks"}
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[1250px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th w-8">#</th>
              <th className="th min-w-[220px]">Invoice line</th>
              <th className="th min-w-[200px]">Stock item (Polosys)</th>
              <th className="th w-20 text-right">Qty (pcs)</th>
              <th className="th w-16 text-right">Free</th>
              <th className="th w-20 text-right">MRP</th>
              <th className="th w-20 text-right" title="MRP printed on the pack, if different or missing on invoice">Pack MRP</th>
              <th className="th w-20 text-right">Rate</th>
              <th className="th w-16 text-right">Disc %</th>
              <th className="th w-20 text-right">Disc ₹</th>
              <th className="th w-20 text-right">Sch ₹</th>
              <th className="th w-24 text-right">Taxable</th>
              <th className="th w-16 text-right">GST %</th>
              <th className="th w-24 text-right">Total</th>
              <th className="th">Check</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const item = l.item_id ? items.get(l.item_id) : undefined;
              const eff = effectiveCost(l);
              const landed = landedCost(l);
              const margin = item?.srate && landed ? ((item.srate - landed) / item.srate) * 100 : null;
              const needsPackMrp = l.price_flag === "mrp_changed" || l.mrp == null;
              return (
                <tr key={l.id} className={`border-b border-slate-100 ${l.review_status === "recheck" ? "bg-rose-50/60" : ""}`}>
                  <td className="td text-slate-400">{l.line_no}</td>
                  <td className="td">
                    {editable ? (
                      <input
                        className="w-full rounded border border-transparent px-1 py-0.5 text-sm font-medium hover:border-slate-200 focus:border-brand-600 focus:outline-none"
                        defaultValue={l.description}
                        key={l.description}
                        onBlur={(e) => e.target.value !== l.description && patchLine(l, { description: e.target.value })}
                      />
                    ) : (
                      <div className="font-medium">{l.description}</div>
                    )}
                    <div className="px-1 text-xs text-slate-500">
                      {[l.item_code && `Code ${l.item_code}`, l.hsn && `HSN ${l.hsn}`, l.uom, l.cases != null && `${l.cases} cs`, l.pieces != null && `${l.pieces} pcs`]
                        .filter(Boolean)
                        .join(" · ")}
                      {l.units_per_case != null && ` · ${l.units_per_case}/case`}
                    </div>
                    {l.extract_note && <div className="px-1 text-xs text-amber-700">📝 {l.extract_note}</div>}
                    {l.review_status === "recheck" && l.review_note && <div className="px-1 text-xs text-rose-700">Manager: {l.review_note}</div>}
                    <label className="mt-1 flex items-center gap-1 px-1 text-xs text-slate-500">
                      <input type="checkbox" checked={l.is_loose} disabled={!editable} onChange={(e) => patchLine(l, { is_loose: e.target.checked })} />
                      Loose / no barcode (count manually)
                    </label>
                  </td>
                  <td className="td">
                    {item ? (
                      <div>
                        <button className="text-left text-sm font-medium text-brand-800 hover:underline disabled:no-underline" disabled={!editable} onClick={() => setPicker(l)}>
                          {item.name}
                        </button>
                        <div className="text-xs text-slate-500">
                          PCode {item.pcode} · MRP {inr(item.mrp)} · Sale {inr(item.srate)} · Cost {inr(item.prate)} · Stock {item.stock ?? "—"}
                        </div>
                        {l.match_source === "fuzzy" && editable && (
                          <button className="mt-1 text-xs font-medium text-amber-700 underline" onClick={() => confirmMatch(l)}>
                            Matched by name — confirm
                          </button>
                        )}
                      </div>
                    ) : (
                      <button className="btn-secondary px-2 py-1 text-xs" disabled={!editable} onClick={() => setPicker(l)}>
                        Find item…
                      </button>
                    )}
                  </td>
                  <td className="td">{num(l, "qty", { highlight: !l.qty })}</td>
                  <td className="td">{num(l, "free_qty")}</td>
                  <td className="td">{num(l, "mrp")}</td>
                  <td className="td">{num(l, "pack_mrp", { highlight: needsPackMrp && l.pack_mrp == null, placeholder: needsPackMrp ? "confirm" : "" })}</td>
                  <td className="td">{num(l, "rate")}</td>
                  <td className="td">{num(l, "discount_pct")}</td>
                  <td className="td">{num(l, "discount_amt")}</td>
                  <td className="td">{num(l, "scheme_amt")}</td>
                  <td className="td">{num(l, "taxable")}</td>
                  <td className="td">{num(l, "gst_pct")}</td>
                  <td className="td">{num(l, "total")}</td>
                  <td className="td min-w-[220px]">
                    {l.price_flag && <span className={`badge ${FLAG_STYLE[l.price_flag]}`}>{FLAG_LABEL[l.price_flag]}</span>}
                    <div className="mt-1 text-xs text-slate-500">
                      Net cost {inr(eff)}/pc · landed {inr(landed)}
                      {margin != null && <span className={margin < (store?.margin_threshold ?? 8) ? " font-medium text-rose-700" : ""}> · margin {margin.toFixed(1)}%</span>}
                    </div>
                    {l.warnings?.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
                        {l.warnings.map((w) => (
                          <li key={w}>• {w}</li>
                        ))}
                      </ul>
                    )}
                    {editable && (
                      <button className="mt-1 text-xs text-slate-400 hover:text-rose-600" onClick={() => deleteLine(l)}>
                        Delete line
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {picker && store && (
        <ItemPicker storeId={store.id} initialQuery={picker.description} onPick={(hit) => pickItem(picker, hit)} onClose={() => setPicker(null)} />
      )}
    </div>
  );
}
