import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { audit, supabase } from "../lib/supabase";
import { parseSohFile, type SohParseResult } from "../lib/soh";
import { searchItems, type SearchHit } from "../lib/match";
import { inr, num } from "../lib/util";

interface Upload {
  id: string;
  file_name: string;
  as_on_date: string | null;
  row_count: number;
  created_at: string;
}

const CHUNK = 500;

/** FR-1: upload the Polosys stock report as the baseline for price checks. */
export default function StockPage() {
  const { store, session } = useAuth();
  const [parsed, setParsed] = useState<(SohParseResult & { fileName: string }) | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [itemCount, setItemCount] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);

  async function loadMeta() {
    if (!store) return;
    const [{ data }, { count }] = await Promise.all([
      supabase.from("soh_uploads").select("*").eq("store_id", store.id).order("created_at", { ascending: false }).limit(10),
      supabase.from("items").select("id", { count: "exact", head: true }).eq("store_id", store.id),
    ]);
    setUploads((data as Upload[]) ?? []);
    setItemCount(count ?? 0);
  }
  useEffect(() => {
    void loadMeta();
  }, [store?.id]);

  useEffect(() => {
    if (!store || q.trim().length < 2) return setHits([]);
    const t = setTimeout(() => searchItems(store.id, q.trim(), 25).then(setHits).catch(() => setHits([])), 250);
    return () => clearTimeout(t);
  }, [q, store?.id]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setMsg(null);
    try {
      setParsed({ ...(await parseSohFile(file)), fileName: file.name });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function importRows() {
    if (!parsed || !store) return;
    setMsg(null);
    setProgress(0);
    try {
      const { data: up, error: upErr } = await supabase
        .from("soh_uploads")
        .insert({ store_id: store.id, file_name: parsed.fileName, as_on_date: parsed.asOnDate, row_count: parsed.rows.length, uploaded_by: session!.user.id })
        .select("id")
        .single();
      if (upErr) throw new Error(upErr.message);

      const now = new Date().toISOString();
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        const chunk = parsed.rows.slice(i, i + CHUNK).map(({ barcode: _b, ...r }) => {
          void _b;
          return { ...r, store_id: store.id, last_upload_id: up.id, updated_at: now };
        });
        const { error } = await supabase.from("items").upsert(chunk, { onConflict: "store_id,pcode" });
        if (error) throw new Error(error.message);
        setProgress(Math.round(((i + chunk.length) / parsed.rows.length) * 100));
      }

      if (parsed.hasBarcode) {
        const withCode = parsed.rows.filter((r) => r.barcode);
        for (let i = 0; i < withCode.length; i += CHUNK) {
          const part = withCode.slice(i, i + CHUNK);
          const { data: ids } = await supabase.from("items").select("id,pcode").eq("store_id", store.id).in("pcode", part.map((r) => r.pcode));
          const idByCode = new Map((ids ?? []).map((r) => [r.pcode, r.id]));
          await supabase.from("item_barcodes").upsert(
            part.filter((r) => idByCode.has(r.pcode)).map((r) => ({ store_id: store.id, barcode: r.barcode!, item_id: idByCode.get(r.pcode)! })),
            { onConflict: "store_id,barcode" },
          );
        }
      }
      await audit("soh_uploaded", "soh_upload", up.id, { rows: parsed.rows.length, file: parsed.fileName });
      setMsg(`Imported ${parsed.rows.length.toLocaleString("en-IN")} items.`);
      setParsed(null);
      await loadMeta();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Stock on hand (SOH) baseline</h1>

      <div className="card space-y-3 p-4">
        <p className="text-sm text-slate-600">
          Export the <b>Stock Report</b> from Polosys (Excel) and upload it here before receiving. Needed columns: Product, PCode, Stock, PRate, SRate. MRP and Barcode
          columns are used if present. Existing items are updated; nothing is deleted.
        </p>
        <input type="file" accept=".xlsx,.xls,.csv" className="text-sm" onChange={(e) => onFile(e.target.files?.[0])} />
        {parsed && (
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <div>
              <b>{parsed.fileName}</b>: {parsed.rows.length.toLocaleString("en-IN")} items{parsed.asOnDate && ` · as on ${parsed.asOnDate}`}
              {parsed.skipped > 0 && ` · ${parsed.skipped} total/duplicate rows skipped`}
            </div>
            <div className="mt-1 text-slate-600">
              MRP column: {parsed.hasMrp ? "yes" : "no — MRP will be learned from approved invoices"} · Barcode column: {parsed.hasBarcode ? "yes" : "no — barcodes are learned while scanning"}
            </div>
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left">PCode</th>
                  <th className="text-left">Product</th>
                  <th className="text-right">Stock</th>
                  <th className="text-right">PRate</th>
                  <th className="text-right">SRate</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 5).map((r) => (
                  <tr key={r.pcode}>
                    <td>{r.pcode}</td>
                    <td>{r.name}</td>
                    <td className="text-right">{num(r.stock)}</td>
                    <td className="text-right">{num(r.prate)}</td>
                    <td className="text-right">{num(r.srate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn-primary mt-3" onClick={importRows} disabled={progress != null}>
              {progress != null ? `Importing… ${progress}%` : "Import to " + store?.name}
            </button>
          </div>
        )}
        {msg && <div className="text-sm text-slate-700">{msg}</div>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="card p-4">
          <div className="mb-2 flex items-center gap-2">
            <div className="text-sm font-medium">Items ({itemCount?.toLocaleString("en-IN") ?? "…"})</div>
            <input className="input ml-auto max-w-xs" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <table className="w-full">
            <tbody className="divide-y divide-slate-100">
              {hits.map((h) => (
                <tr key={h.id}>
                  <td className="td">
                    <div className="font-medium">{h.name}</div>
                    <div className="text-xs text-slate-500">PCode {h.pcode}</div>
                  </td>
                  <td className="td text-right text-xs">MRP {inr(h.mrp)}</td>
                  <td className="td text-right text-xs">Sale {inr(h.srate)}</td>
                  <td className="td text-right text-xs">Cost {inr(h.prate)}</td>
                  <td className="td text-right text-xs">Stock {num(h.stock)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {q.trim().length < 2 && <div className="text-sm text-slate-500">Type to search the stock master.</div>}
        </div>
        <div className="card p-4">
          <div className="mb-2 text-sm font-medium">Recent uploads</div>
          <ul className="space-y-2 text-sm">
            {uploads.map((u) => (
              <li key={u.id}>
                <div>{u.file_name}</div>
                <div className="text-xs text-slate-500">
                  {u.row_count.toLocaleString("en-IN")} items · {u.as_on_date ? `as on ${u.as_on_date} · ` : ""}
                  uploaded {new Date(u.created_at).toLocaleString("en-IN")}
                </div>
              </li>
            ))}
            {uploads.length === 0 && <li className="text-slate-500">None yet.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
