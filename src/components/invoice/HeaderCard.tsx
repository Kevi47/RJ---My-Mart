import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { audit, supabase } from "../../lib/supabase";
import type { Invoice, InvoiceLine } from "../../lib/types";
import { validateHeader } from "../../lib/validate";
import { decodeEInvoiceQr, dmyToIso, inr, type EInvoiceQr } from "../../lib/util";
import { findOrCreateSupplier } from "../../lib/match";
import BarcodeScanner from "../BarcodeScanner";
import NumInput from "../NumInput";

interface Props {
  invoice: Invoice;
  lines: InvoiceLine[];
  editable: boolean;
  onChange: (patch: Partial<Invoice>) => void;
}

const TEXT_FIELDS: [keyof Invoice, string][] = [
  ["supplier_name", "Supplier"],
  ["supplier_gstin", "Supplier GSTIN"],
  ["invoice_no", "Invoice no"],
  ["po_no", "PO / order no"],
  ["internal_ref", "Inward ref (circled no.)"],
  ["lf_no", "LF no"],
];

export default function HeaderCard({ invoice, lines, editable, onChange }: Props) {
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [duplicates, setDuplicates] = useState<Invoice[]>([]);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrResult, setQrResult] = useState<{ data: EInvoiceQr; mismatches: string[] } | null>(null);

  useEffect(() => {
    if (!invoice.image_paths.length) return;
    supabase.storage
      .from("invoices")
      .createSignedUrls(invoice.image_paths, 3600)
      .then(({ data }) => setImageUrls((data ?? []).map((d) => d.signedUrl).filter(Boolean) as string[]));
  }, [invoice.image_paths.join("|")]);

  // FR-12 duplicate check: same supplier + invoice number already processed
  useEffect(() => {
    if (!invoice.invoice_no) return setDuplicates([]);
    let q = supabase.from("invoices").select("*").eq("invoice_no", invoice.invoice_no).neq("id", invoice.id);
    q = invoice.supplier_gstin ? q.eq("supplier_gstin", invoice.supplier_gstin) : q.ilike("supplier_name", invoice.supplier_name ?? "");
    q.then(({ data }) => setDuplicates((data as Invoice[]) ?? []));
  }, [invoice.invoice_no, invoice.supplier_gstin, invoice.supplier_name, invoice.id]);

  const validation = useMemo(
    () => validateHeader(lines, { invoice_total: invoice.invoice_total, round_off: invoice.round_off }),
    [lines, invoice.invoice_total, invoice.round_off],
  );

  async function save(patch: Partial<Invoice>) {
    onChange(patch);
    if ("supplier_name" in patch || "supplier_gstin" in patch) {
      const supplier_id = await findOrCreateSupplier(patch.supplier_name ?? invoice.supplier_name, patch.supplier_gstin ?? invoice.supplier_gstin);
      patch = { ...patch, supplier_id };
      onChange({ supplier_id });
    }
    await supabase.from("invoices").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", invoice.id);
  }

  async function onQr(text: string) {
    const data = decodeEInvoiceQr(text);
    if (!data) return;
    setQrOpen(false);
    const mismatches: string[] = [];
    const patch: Partial<Invoice> = {};
    const cmp = (label: string, field: keyof Invoice, qrVal: string | number | null | undefined) => {
      if (qrVal == null || qrVal === "") return;
      const cur = invoice[field];
      if (cur == null || cur === "") (patch as Record<string, unknown>)[field] = qrVal;
      else if (String(cur).toUpperCase() !== String(qrVal).toUpperCase()) mismatches.push(`${label}: invoice shows ${cur}, QR says ${qrVal}`);
    };
    cmp("Supplier GSTIN", "supplier_gstin", data.SellerGstin);
    cmp("Invoice no", "invoice_no", data.DocNo);
    cmp("Invoice date", "invoice_date", dmyToIso(data.DocDt));
    cmp("IRN", "irn", data.Irn);
    if (data.TotInvVal != null && invoice.invoice_total != null && Math.abs(data.TotInvVal - invoice.invoice_total) > 1) {
      mismatches.push(`Total: invoice shows ${inr(invoice.invoice_total)}, QR says ${inr(data.TotInvVal)}`);
    } else if (invoice.invoice_total == null && data.TotInvVal != null) patch.invoice_total = data.TotInvVal;
    if (data.ItemCnt != null && data.ItemCnt !== lines.length) mismatches.push(`QR lists ${data.ItemCnt} items; ${lines.length} lines were read`);
    if (Object.keys(patch).length) await save(patch);
    setQrResult({ data, mismatches });
    await audit("einvoice_qr_verified", "invoice", invoice.id, { mismatches });
  }

  return (
    <div className="card p-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {TEXT_FIELDS.map(([field, label]) => (
              <div key={field}>
                <label className="label">{label}</label>
                <input
                  className="input py-1.5"
                  defaultValue={(invoice[field] as string | null) ?? ""}
                  key={`${field}-${invoice[field] as string}`}
                  disabled={!editable}
                  onBlur={(e) => e.target.value !== (invoice[field] ?? "") && save({ [field]: e.target.value || null })}
                />
              </div>
            ))}
            <div>
              <label className="label">Invoice date</label>
              <input
                type="date"
                className="input py-1.5"
                value={invoice.invoice_date ?? ""}
                disabled={!editable}
                onChange={(e) => save({ invoice_date: e.target.value || null })}
              />
            </div>
            <div>
              <label className="label">Round off</label>
              <NumInput value={invoice.round_off} disabled={!editable} onCommit={(v) => save({ round_off: v })} className="py-1.5 text-left" />
            </div>
            <div>
              <label className="label">Invoice total</label>
              <NumInput value={invoice.invoice_total} disabled={!editable} onCommit={(v) => save({ invoice_total: v })} className="py-1.5 text-left" />
            </div>
          </div>

          <div className={`rounded-lg p-3 text-sm ${validation.ok ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>
            <div className="font-medium">
              {validation.ok ? "✓ Lines add up to the invoice total" : "Totals do not reconcile"} — lines {inr(validation.lines_sum)}
              {invoice.round_off ? ` + round-off ${inr(invoice.round_off)}` : ""} vs invoice {inr(validation.expected_total)}
            </div>
            {validation.messages.map((m) => (
              <div key={m}>• {m}</div>
            ))}
            {Array.isArray((invoice.validation as { messages?: string[] } | null)?.messages) &&
              invoice.validation!.messages
                .filter((m) => !validation.messages.includes(m) && !/^Lines add up|line\(s\) have no amount|Invoice total not captured/.test(m))
                .map((m) => <div key={m}>• {m}</div>)}
          </div>

          {duplicates.length > 0 && (
            <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
              ⚠ This supplier invoice number was already entered:{" "}
              {duplicates.map((d) => (
                <Link key={d.id} to={`/invoices/${d.id}`} className="mr-2 underline">
                  {d.invoice_no} ({d.status}, {new Date(d.created_at).toLocaleDateString("en-IN")})
                </Link>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-secondary" onClick={() => setQrOpen(true)} disabled={!editable}>
              Verify with e-invoice QR
            </button>
            {invoice.irn && <span className="truncate text-xs text-slate-500">IRN {invoice.irn}</span>}
          </div>
          {qrResult && (
            <div className={`rounded-lg p-3 text-sm ${qrResult.mismatches.length ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900"}`}>
              {qrResult.mismatches.length ? qrResult.mismatches.map((m) => <div key={m}>• {m}</div>) : "✓ Header matches the e-invoice QR"}
            </div>
          )}
        </div>

        {imageUrls.length > 0 && (
          <div className="flex gap-2 lg:flex-col">
            {imageUrls.map((u, i) => (
              <a key={u} href={u} target="_blank" rel="noreferrer" title={`Open page ${i + 1}`}>
                <img src={u} alt={`Invoice page ${i + 1}`} className="h-28 w-24 rounded border border-slate-200 object-cover hover:ring-2 hover:ring-brand-600" />
              </a>
            ))}
          </div>
        )}
      </div>

      {qrOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setQrOpen(false)}>
          <div className="card w-full max-w-md p-3" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-sm font-medium">Point the camera at the e-invoice QR code</div>
            <BarcodeScanner className="aspect-square" onDetect={(code) => void onQr(code)} />
            <button className="btn-ghost mt-2 w-full" onClick={() => setQrOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
