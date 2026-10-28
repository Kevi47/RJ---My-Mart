// FR-5 live scan counter + FR-10 learn-once barcode linking, shared by phone and laptop.
import { useCallback, useEffect, useRef, useState } from "react";
import { selectAll, supabase } from "./supabase";
import { recordScan, deviceLabel, type QueuedScan } from "./scanQueue";
import { expectedQty, type InvoiceData } from "./useInvoice";
import type { InvoiceLine, Item, Scan } from "./types";
import { beep, uuid } from "./util";

export type ScanOutcome =
  | { kind: "counted"; line: InvoiceLine; count: number; expected: number; over: boolean; barcode: string }
  | { kind: "not_on_invoice"; barcode: string; item: Item | null }
  | { kind: "unknown"; barcode: string }
  | { kind: "error"; message: string };

export function useScanner(inv: InvoiceData, storeId: string | undefined, userId: string | undefined) {
  const [last, setLast] = useState<ScanOutcome | null>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null); // barcode awaiting a line choice
  const itemBarcodes = useRef<Map<string, string>>(new Map()); // barcode → item id
  const invRef = useRef(inv);
  invRef.current = inv;

  useEffect(() => {
    if (!storeId) return;
    selectAll<{ barcode: string; item_id: string }>((from, to) =>
      supabase.from("item_barcodes").select("barcode,item_id").eq("store_id", storeId).range(from, to),
    )
      .then((rows) => {
        itemBarcodes.current = new Map(rows.map((r) => [r.barcode, r.item_id]));
      })
      .catch(() => {
        /* fall back to per-scan lookups */
      });
  }, [storeId]);

  const addScan = useCallback(
    async (lineId: string | null, barcode: string | null, qty = 1, kind: "scan" | "manual" = "scan") => {
      if (!userId) return;
      const row: QueuedScan = {
        id: uuid(),
        invoice_id: invRef.current.invoice!.id,
        line_id: lineId,
        barcode,
        qty,
        kind,
        user_id: userId,
        device_label: deviceLabel(),
        scanned_at: new Date().toISOString(),
      };
      // Optimistic; the realtime echo is de-duplicated by id
      invRef.current.setScans((prev) => [...prev, { ...row, undone: false } satisfies Scan]);
      await recordScan(row);
    },
    [userId],
  );

  const countFor = (lineId: string, extra = 0) => (invRef.current.counts.get(lineId) ?? 0) + extra;

  const countLine = useCallback(
    async (line: InvoiceLine, barcode: string) => {
      await addScan(line.id, barcode);
      const count = countFor(line.id, 1);
      const expected = expectedQty(line);
      const over = count > expected;
      beep(over ? "warn" : "ok");
      setLast({ kind: "counted", line, count, expected, over, barcode });
    },
    [addScan],
  );

  const handleCode = useCallback(
    async (raw: string) => {
      const barcode = raw.trim();
      if (!barcode) return;
      const { invoiceBarcodes, lines, counts } = invRef.current;
      if (!invRef.current.invoice) return;

      // 1. Barcode already linked to a line on this invoice
      const linkedLine = lines.find((l) => l.id === invoiceBarcodes.get(barcode));
      if (linkedLine) return countLine(linkedLine, barcode);

      // 2. Known product barcode → its line(s) on this invoice
      let itemId = itemBarcodes.current.get(barcode);
      if (!itemId && storeId) {
        const { data } = await supabase.from("item_barcodes").select("item_id").eq("store_id", storeId).eq("barcode", barcode).maybeSingle();
        if (data) {
          itemId = data.item_id as string;
          itemBarcodes.current.set(barcode, itemId);
        }
      }
      if (itemId) {
        const candidates = lines.filter((l) => l.item_id === itemId);
        // Same item on two lines (e.g. two MRPs): fill the first line that still has room.
        const line = candidates.find((l) => (counts.get(l.id) ?? 0) < expectedQty(l)) ?? candidates[0];
        if (line) return countLine(line, barcode);
        const { data: item } = await supabase.from("items").select("*").eq("id", itemId).maybeSingle();
        await addScan(null, barcode);
        beep("error");
        setLast({ kind: "not_on_invoice", barcode, item: item as Item | null });
        return;
      }

      // 3. Never seen — ask which invoice line this is (learn once)
      beep("warn");
      setLast({ kind: "unknown", barcode });
      setPendingLink(barcode);
    },
    [storeId, countLine, addScan],
  );

  /** Link an unknown barcode to a line, remember it, and count this unit. */
  const linkToLine = useCallback(
    async (lineId: string) => {
      const barcode = pendingLink;
      const line = invRef.current.lines.find((l) => l.id === lineId);
      if (!barcode || !line) return;
      setPendingLink(null);
      invRef.current.setInvoiceBarcodes((prev) => new Map(prev).set(barcode, lineId));
      await supabase.from("invoice_barcodes").upsert({ invoice_id: line.invoice_id, barcode, line_id: lineId });
      if (line.item_id && storeId) {
        itemBarcodes.current.set(barcode, line.item_id);
        await supabase
          .from("item_barcodes")
          .upsert({ store_id: storeId, barcode, item_id: line.item_id, created_by: userId }, { onConflict: "store_id,barcode" });
      }
      await countLine(line, barcode);
    },
    [pendingLink, storeId, userId, countLine],
  );

  const markNotOnInvoice = useCallback(async () => {
    const barcode = pendingLink;
    setPendingLink(null);
    if (barcode) {
      await addScan(null, barcode);
      setLast({ kind: "not_on_invoice", barcode, item: null });
    }
  }, [pendingLink, addScan]);

  const undo = useCallback(
    async (scanId: string) => {
      invRef.current.setScans((prev) => prev.map((s) => (s.id === scanId ? { ...s, undone: true } : s)));
      await supabase.from("scans").update({ undone: true, undone_by: userId }).eq("id", scanId);
    },
    [userId],
  );

  const undoLast = useCallback(async () => {
    const mine = invRef.current.scans.filter((s) => !s.undone && s.device_label === deviceLabel());
    const lastScan = mine[mine.length - 1];
    if (lastScan) {
      await undo(lastScan.id);
      setLast(null);
    }
  }, [undo]);

  /** Loose goods or bulk counts: set the line's received qty directly (Q4). */
  const setManualCount = useCallback(
    async (line: InvoiceLine, target: number) => {
      const delta = target - countFor(line.id);
      if (delta !== 0) await addScan(line.id, null, delta, "manual");
    },
    [addScan],
  );

  return { last, setLast, pendingLink, setPendingLink, handleCode, linkToLine, markNotOnInvoice, undo, undoLast, setManualCount, addScan };
}
