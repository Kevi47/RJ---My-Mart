import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { expectedQty, type InvoiceData } from "../../lib/useInvoice";
import { FLAG_LABEL, FLAG_STYLE } from "../../lib/match";
import { effectiveCost, landedCost } from "../../lib/validate";
import { exportInvoice } from "../../lib/exportPolosys";
import { inr } from "../../lib/util";

/** FR-6 reconciliation report, FR-7 approval, FR-8 export. */
export default function ReconcileTab({ data }: { data: InvoiceData }) {
  const { isManager, store } = useAuth();
  const { invoice, lines, items, counts, unmatchedScans, reload } = data;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rows = lines.map((l) => {
    const exp = expectedQty(l);
    const rec = counts.get(l.id) ?? 0;
    const item = l.item_id ? items.get(l.item_id) : undefined;
    const landed = landedCost(l);
    return {
      l,
      item,
      exp,
      rec,
      diff: rec - exp,
      eff: effectiveCost(l),
      landed,
      valueDiff: landed != null ? (rec - exp) * landed : null,
      margin: item?.srate && landed ? ((item.srate - landed) / item.srate) * 100 : null,
    };
  });
  const short = rows.filter((r) => r.diff < 0);
  const excess = rows.filter((r) => r.diff > 0);
  const priceFlags = rows.filter((r) => r.l.price_flag && r.l.price_flag !== "ok");
  const shortValue = short.reduce((s, r) => s + (r.valueDiff ?? 0), 0);
  const missingPackMrp = rows.filter((r) => r.l.price_flag === "mrp_changed" && r.l.pack_mrp == null);
  const canDecide = isManager && invoice!.status === "scanned";

  async function approve() {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("approve_invoice", { p_invoice: invoice!.id, p_note: note || null });
    setBusy(false);
    if (error) setErr(error.message);
    else await reload();
  }

  async function sendBack() {
    if (!selected.size) return setErr("Tick the lines to send back for re-scan or correction.");
    if (!note.trim()) return setErr("Add a note saying what to fix.");
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("reject_invoice", { p_invoice: invoice!.id, p_line_ids: [...selected], p_note: note });
    setBusy(false);
    if (error) setErr(error.message);
    else {
      setSelected(new Set());
      await reload();
    }
  }

  async function doExport() {
    exportInvoice(invoice!, lines, items, counts);
    if (invoice!.status === "approved") {
      await supabase.from("invoices").update({ status: "exported", exported_at: new Date().toISOString() }).eq("id", invoice!.id);
      await supabase.from("audit_log").insert({ action: "invoice_exported", entity: "invoice", entity_id: invoice!.id });
      await reload();
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Lines matching" value={rows.filter((r) => r.diff === 0).length} total={rows.length} tone="emerald" />
        <Stat label="Short lines" value={short.length} sub={short.length ? inr(Math.abs(shortValue)) + " at cost" : undefined} tone="amber" />
        <Stat label="Excess lines" value={excess.length} tone="rose" />
        <Stat label="Price flags" value={priceFlags.length} tone="sky" />
      </div>

      {(unmatchedScans.length > 0 || missingPackMrp.length > 0) && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {unmatchedScans.length > 0 && <div>• {unmatchedScans.length} scanned unit(s) were not on this invoice — see Receive tab.</div>}
          {missingPackMrp.length > 0 && <div>• {missingPackMrp.length} MRP-changed line(s) have no confirmed pack MRP.</div>}
        </div>
      )}

      <div className="card overflow-x-auto print:overflow-visible print:shadow-none">
        <table className="w-full min-w-[1000px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {canDecide && <th className="th w-8"></th>}
              <th className="th w-8">#</th>
              <th className="th">Item</th>
              <th className="th text-right">Invoice qty</th>
              <th className="th text-right">Received</th>
              <th className="th text-right">Qty variance</th>
              <th className="th text-right">MRP SOH → invoice</th>
              <th className="th text-right">Cost SOH → net</th>
              <th className="th text-right">Sale / margin</th>
              <th className="th">Price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(({ l, item, exp, rec, diff, eff, margin }) => {
              const mrpInv = l.pack_mrp ?? l.mrp;
              const qtyTone = diff === 0 ? "" : diff < 0 ? "bg-amber-50" : "bg-rose-50";
              return (
                <tr key={l.id} className={l.review_status === "recheck" ? "bg-rose-50/60" : ""}>
                  {canDecide && (
                    <td className="td">
                      <input
                        type="checkbox"
                        checked={selected.has(l.id)}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const n = new Set(prev);
                            e.target.checked ? n.add(l.id) : n.delete(l.id);
                            return n;
                          })
                        }
                      />
                    </td>
                  )}
                  <td className="td text-slate-400">{l.line_no}</td>
                  <td className="td">
                    <div className="font-medium">{item?.name ?? l.description}</div>
                    <div className="text-xs text-slate-500">{item ? `PCode ${item.pcode}` : "Not in stock master"}</div>
                  </td>
                  <td className="td text-right tabular-nums">{exp}</td>
                  <td className="td text-right tabular-nums">{rec}</td>
                  <td className={`td text-right font-semibold tabular-nums ${qtyTone} ${diff < 0 ? "text-amber-800" : diff > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                    {diff === 0 ? "✓" : diff > 0 ? `+${diff}` : diff}
                  </td>
                  <td className={`td text-right tabular-nums ${l.price_flag === "mrp_changed" ? "bg-amber-50 font-medium" : ""}`}>
                    {inr(item?.mrp)} → {inr(mrpInv)}
                  </td>
                  <td className={`td text-right tabular-nums ${l.price_flag === "cost_changed" ? "bg-sky-50 font-medium" : ""}`}>
                    {inr(item?.prate)} → {inr(eff)}
                  </td>
                  <td className={`td text-right tabular-nums ${margin != null && margin < (store?.margin_threshold ?? 8) ? "text-rose-700" : ""}`}>
                    {inr(item?.srate)}
                    {margin != null && <div className="text-xs">{margin.toFixed(1)}%</div>}
                  </td>
                  <td className="td">{l.price_flag && <span className={`badge ${FLAG_STYLE[l.price_flag]}`}>{FLAG_LABEL[l.price_flag]}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card space-y-3 p-4 print:hidden">
        {invoice!.status === "scanned" && !isManager && <div className="text-sm text-slate-600">Waiting for a manager to approve.</div>}
        {canDecide && (
          <>
            <div>
              <label className="label">Note (required when sending lines back)</label>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Re-count Ariel Mat 1kg; supplier short-shipped line 4" />
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" disabled={busy} onClick={approve}>
                Approve for Polosys
              </button>
              <button className="btn-secondary" disabled={busy} onClick={sendBack}>
                Send {selected.size || ""} line(s) back
              </button>
            </div>
          </>
        )}
        {(invoice!.status === "approved" || invoice!.status === "exported") && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-emerald-800">
              Approved {invoice!.approved_at ? new Date(invoice!.approved_at).toLocaleString("en-IN") : ""}
              {invoice!.exported_at && ` · exported ${new Date(invoice!.exported_at).toLocaleString("en-IN")}`}
            </div>
            <button className="btn-primary ml-auto" onClick={doExport} disabled={!isManager && invoice!.status === "approved"}>
              Download Polosys import file
            </button>
          </div>
        )}
        <button className="btn-ghost" onClick={() => window.print()}>
          Print report
        </button>
        {err && <div className="text-sm text-rose-700">{err}</div>}
      </div>
    </div>
  );
}

function Stat({ label, value, total, sub, tone }: { label: string; value: number; total?: number; sub?: string; tone: string }) {
  const colors: Record<string, string> = {
    emerald: "text-emerald-700",
    amber: "text-amber-700",
    rose: "text-rose-700",
    sky: "text-sky-700",
  };
  return (
    <div className="card p-3">
      <div className={`text-2xl font-semibold tabular-nums ${value ? colors[tone] : "text-slate-400"}`}>
        {value}
        {total != null && <span className="text-sm font-normal text-slate-400"> / {total}</span>}
      </div>
      <div className="text-xs text-slate-500">{label}</div>
      {sub && <div className="text-xs text-slate-600">{sub}</div>}
    </div>
  );
}
