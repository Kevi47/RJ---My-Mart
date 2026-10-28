import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { audit, supabase } from "../lib/supabase";
import { prepareImage, uuid, type PreparedImage } from "../lib/util";
import type { ExtractedInvoice } from "../../api/_lib/extractSchema";
import { findOrCreateSupplier, matchLines } from "../lib/match";
import { runChecks } from "../lib/checks";
import { validateHeader } from "../lib/validate";
import type { InvoiceLine, Item } from "../lib/types";

type Step = "idle" | "preparing" | "uploading" | "reading" | "matching" | "error";

const STEP_LABEL: Record<Step, string> = {
  idle: "",
  preparing: "Preparing photos…",
  uploading: "Uploading photos…",
  reading: "Reading the invoice (about 20–60 seconds)…",
  matching: "Matching items against stock…",
  error: "",
};

export default function NewInvoice() {
  const { store, session } = useAuth();
  const nav = useNavigate();
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setStep("preparing");
    try {
      const prepared = await Promise.all([...files].filter((f) => f.type.startsWith("image/")).map((f) => prepareImage(f)));
      setImages((prev) => [...prev, ...prepared].slice(0, 6));
      setStep("idle");
    } catch (e) {
      setError(String(e));
      setStep("error");
    }
  }

  function move(i: number, d: number) {
    setImages((prev) => {
      const next = prev.slice();
      const j = i + d;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function createBlank() {
    if (!store) return;
    const { data, error } = await supabase
      .from("invoices")
      .insert({ store_id: store.id, status: "review", created_by: session!.user.id })
      .select("id")
      .single();
    if (error) return setError(error.message);
    nav(`/invoices/${data.id}`);
  }

  async function readInvoice() {
    if (!store || !images.length) return;
    setError(null);
    const invoiceId = uuid();
    try {
      setStep("uploading");
      const paths: string[] = [];
      for (const [n, img] of images.entries()) {
        const path = `${store.id}/${invoiceId}/${n + 1}.jpg`;
        const { error } = await supabase.storage.from("invoices").upload(path, img.blob, { contentType: "image/jpeg", upsert: true });
        if (error) throw new Error(`Upload failed: ${error.message}`);
        paths.push(path);
      }

      setStep("reading");
      const { data: sess } = await supabase.auth.getSession();
      const resp = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token}` },
        body: JSON.stringify({ images: images.map(({ data, media_type }) => ({ data, media_type })) }),
      });
      const body = await resp.json().catch(() => ({ error: `Server error ${resp.status}` }));
      if (!resp.ok) throw new Error(body.error ?? `Server error ${resp.status}`);
      const ex = body.invoice as ExtractedInvoice;

      setStep("matching");
      const supplierId = await findOrCreateSupplier(ex.supplier_name, ex.supplier_gstin);
      const matches = await matchLines(store.id, supplierId, ex.lines);

      const { error: invErr } = await supabase.from("invoices").insert({
        id: invoiceId,
        store_id: store.id,
        supplier_id: supplierId,
        supplier_name: ex.supplier_name,
        supplier_gstin: ex.supplier_gstin,
        invoice_no: ex.invoice_no,
        invoice_date: /^\d{4}-\d{2}-\d{2}$/.test(ex.invoice_date ?? "") ? ex.invoice_date : null,
        po_no: ex.po_no,
        internal_ref: ex.internal_ref,
        lf_no: ex.lf_no,
        irn: ex.irn,
        subtotal: ex.subtotal,
        tax_total: ex.tax_total,
        round_off: ex.round_off,
        invoice_total: ex.invoice_total,
        status: "review",
        image_paths: paths,
        extraction: { ...ex, model: body.model, usage: body.usage },
        created_by: session!.user.id,
      });
      if (invErr) throw new Error(invErr.message);

      const lineRows = ex.lines.map((l, i) => {
        const m = matches[i];
        const upc = l.units_per_case ?? m.units_per_case ?? null;
        // FR-11: normalise to pieces when the invoice gives cases + pieces
        const qty = l.cases != null && upc ? l.cases * upc + (l.pieces ?? 0) : l.qty;
        const gross = l.gross ?? (l.rate != null ? qty * l.rate : null);
        const notes = [l.handwritten_note, l.confidence === "low" ? "Low-confidence read — check figures against the paper" : null].filter(Boolean);
        return {
          invoice_id: invoiceId,
          line_no: i + 1,
          item_code: l.item_code,
          description: l.description,
          hsn: l.hsn,
          uom: l.uom,
          cases: l.cases,
          pieces: l.pieces,
          units_per_case: upc,
          qty,
          free_qty: l.free_qty ?? 0,
          mrp: l.mrp,
          rate: l.rate,
          gross,
          discount_pct: l.discount_pct,
          discount_amt: l.discount_amt,
          scheme_amt: l.scheme_amt,
          // A line amount printed without tax (tax added below the lines) is the taxable value
          taxable: l.taxable ?? (!ex.line_amounts_include_tax && l.total != null && l.tax_amt == null ? l.total : null),
          gst_pct: l.gst_pct,
          tax_amt: l.tax_amt,
          total: ex.line_amounts_include_tax || l.tax_amt != null ? l.total : null,
          batch: l.batch,
          expiry: l.expiry,
          item_id: m.item_id,
          match_source: m.match_source,
          extract_note: notes.length ? notes.join(" · ") : null,
        };
      });
      const { data: inserted, error: lineErr } = await supabase.from("invoice_lines").insert(lineRows).select("*");
      if (lineErr) throw new Error(lineErr.message);

      const itemIds = [...new Set(lineRows.map((l) => l.item_id).filter(Boolean))] as string[];
      const { data: itemRows } = itemIds.length ? await supabase.from("items").select("*").in("id", itemIds) : { data: [] };
      const items = new Map(((itemRows as Item[]) ?? []).map((it) => [it.id, it]));
      const checked = await runChecks(inserted as InvoiceLine[], items, store);
      const validation = validateHeader(checked, { invoice_total: ex.invoice_total, round_off: ex.round_off });
      validation.messages.push(...ex.notes);
      await supabase.from("invoices").update({ validation }).eq("id", invoiceId);
      await audit("invoice_extracted", "invoice", invoiceId, { lines: lineRows.length, model: body.model });

      nav(`/invoices/${invoiceId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("error");
    }
  }

  const busy = step !== "idle" && step !== "error";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">New invoice</h1>
      <div className="card space-y-4 p-4">
        <p className="text-sm text-slate-600">
          Photograph the whole invoice, flat and in good light. For multi-page invoices add each page in order (up to 6).
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={busy} onClick={() => cameraRef.current?.click()}>
            Take photo
          </button>
          <button className="btn-secondary" disabled={busy} onClick={() => filesRef.current?.click()}>
            Choose images
          </button>
          <button className="btn-ghost ml-auto" disabled={busy} onClick={createBlank}>
            Enter manually instead
          </button>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => addFiles(e.target.files)} />
          <input ref={filesRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        </div>

        {images.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {images.map((img, i) => (
              <div key={img.preview.slice(-40) + i} className="relative overflow-hidden rounded-lg border border-slate-200">
                <img src={img.preview} alt={`Page ${i + 1}`} className="aspect-[3/4] w-full object-cover" />
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/60 px-2 py-1 text-xs text-white">
                  <span>Page {i + 1}</span>
                  <span className="flex gap-2">
                    <button onClick={() => move(i, -1)} disabled={busy} aria-label="Move earlier">
                      ←
                    </button>
                    <button onClick={() => move(i, 1)} disabled={busy} aria-label="Move later">
                      →
                    </button>
                    <button onClick={() => setImages((p) => p.filter((_, j) => j !== i))} disabled={busy}>
                      Remove
                    </button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
        {busy && (
          <div className="flex items-center gap-3 rounded-lg bg-brand-50 p-3 text-sm text-brand-800">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-700 border-t-transparent" />
            {STEP_LABEL[step]}
          </div>
        )}

        <div className="flex justify-end">
          <button className="btn-primary" disabled={!images.length || busy || !store} onClick={readInvoice}>
            Read invoice
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Every figure the system reads is shown for you to check before anything is counted or approved.
      </p>
    </div>
  );
}
