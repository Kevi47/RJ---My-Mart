import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import type { Invoice, InvoiceLine, Item, Scan } from "./types";

export interface InvoiceData {
  invoice: Invoice | null;
  lines: InvoiceLine[];
  scans: Scan[];
  items: Map<string, Item>;
  invoiceBarcodes: Map<string, string>; // barcode → line id
  counts: Map<string, number>; // line id → scanned qty (non-undone)
  unmatchedScans: Scan[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  setLines: React.Dispatch<React.SetStateAction<InvoiceLine[]>>;
  setInvoice: React.Dispatch<React.SetStateAction<Invoice | null>>;
  setScans: React.Dispatch<React.SetStateAction<Scan[]>>;
  setItems: React.Dispatch<React.SetStateAction<Map<string, Item>>>;
  setInvoiceBarcodes: React.Dispatch<React.SetStateAction<Map<string, string>>>;
}

/** Loads an invoice with its lines and scans, and keeps scans/lines live across devices (FR-14). */
export function useInvoice(id: string | undefined, opts: { live?: boolean } = {}): InvoiceData {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [items, setItems] = useState<Map<string, Item>>(new Map());
  const [invoiceBarcodes, setInvoiceBarcodes] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) return;
    const [inv, ls, sc, ib] = await Promise.all([
      supabase.from("invoices").select("*").eq("id", id).single(),
      supabase.from("invoice_lines").select("*").eq("invoice_id", id).order("line_no"),
      supabase.from("scans").select("*").eq("invoice_id", id).order("scanned_at"),
      supabase.from("invoice_barcodes").select("barcode,line_id").eq("invoice_id", id),
    ]);
    if (inv.error) {
      setError(inv.error.message);
      setLoading(false);
      return;
    }
    setInvoice(inv.data as Invoice);
    const lineRows = (ls.data as InvoiceLine[]) ?? [];
    setLines(lineRows);
    setScans((sc.data as Scan[]) ?? []);
    setInvoiceBarcodes(new Map((ib.data ?? []).map((r) => [r.barcode, r.line_id])));
    const itemIds = [...new Set(lineRows.map((l) => l.item_id).filter(Boolean))] as string[];
    if (itemIds.length) {
      const { data } = await supabase.from("items").select("*").in("id", itemIds);
      setItems(new Map(((data as Item[]) ?? []).map((i) => [i.id, i])));
    } else setItems(new Map());
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!id || !opts.live) return;
    const channel = supabase
      .channel(`invoice-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "scans", filter: `invoice_id=eq.${id}` }, (p) => {
        if (p.eventType === "DELETE") {
          setScans((prev) => prev.filter((s) => s.id !== (p.old as Scan).id));
          return;
        }
        const row = p.new as Scan;
        setScans((prev) => {
          const i = prev.findIndex((s) => s.id === row.id);
          if (i < 0) return [...prev, row];
          const next = prev.slice();
          next[i] = row;
          return next;
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "invoice_lines", filter: `invoice_id=eq.${id}` }, (p) => {
        if (p.eventType === "DELETE") {
          setLines((prev) => prev.filter((l) => l.id !== (p.old as InvoiceLine).id));
          return;
        }
        const row = p.new as InvoiceLine;
        setLines((prev) => {
          const i = prev.findIndex((l) => l.id === row.id);
          const next = i < 0 ? [...prev, row] : prev.map((l) => (l.id === row.id ? row : l));
          return next.sort((a, b) => a.line_no - b.line_no);
        });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "invoice_barcodes", filter: `invoice_id=eq.${id}` }, (p) => {
        const row = p.new as { barcode: string; line_id: string };
        setInvoiceBarcodes((prev) => new Map(prev).set(row.barcode, row.line_id));
      })
      .subscribe();
    // Catch anything missed while the socket was reconnecting.
    const onVisible = () => document.visibilityState === "visible" && void reload();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      void supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [id, opts.live, reload]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of scans) if (!s.undone && s.line_id) m.set(s.line_id, (m.get(s.line_id) ?? 0) + s.qty);
    return m;
  }, [scans]);

  const unmatchedScans = useMemo(() => scans.filter((s) => !s.undone && !s.line_id), [scans]);

  return { invoice, lines, scans, items, invoiceBarcodes, counts, unmatchedScans, loading, error, reload, setLines, setInvoice, setScans, setItems, setInvoiceBarcodes };
}

/** Units the line expects on the shelf: billed + free. */
export const expectedQty = (l: InvoiceLine) => l.qty + (l.free_qty ?? 0);

/** Received qty for a line — manual-count lines use the same scans table with kind=manual. */
export const receivedQty = (l: InvoiceLine, counts: Map<string, number>) => counts.get(l.id) ?? 0;
