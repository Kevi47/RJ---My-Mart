import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useAuth } from "../../lib/auth";
import { expectedQty, type InvoiceData } from "../../lib/useInvoice";
import { useScanner } from "../../lib/useScanner";
import type { InvoiceLine } from "../../lib/types";
import LinkBarcodeModal from "./LinkBarcodeModal";
import ScanOutcomeBanner from "./ScanOutcomeBanner";

export function progressStyle(count: number, expected: number) {
  if (count === 0) return { bar: "bg-slate-300", text: "text-slate-500", label: "Not started" };
  if (count < expected) return { bar: "bg-amber-500", text: "text-amber-700", label: "Short" };
  if (count === expected) return { bar: "bg-emerald-500", text: "text-emerald-700", label: "Complete" };
  return { bar: "bg-rose-500", text: "text-rose-700", label: "Over" };
}

export default function ReceiveTab({ data, active }: { data: InvoiceData; active: boolean }) {
  const { store, session } = useAuth();
  const scanner = useScanner(data, store?.id, session?.user.id);
  const [qr, setQr] = useState<string | null>(null);
  const [wedge, setWedge] = useState("");
  const wedgeRef = useRef<HTMLInputElement>(null);
  const { lines, counts, invoice, unmatchedScans } = data;
  const scanUrl = `${window.location.origin}/scan/${invoice!.id}`;

  useEffect(() => {
    QRCode.toDataURL(scanUrl, { margin: 1, width: 220 }).then(setQr);
  }, [scanUrl]);

  const totals = lines.reduce(
    (acc, l) => {
      acc.expected += expectedQty(l);
      acc.received += Math.min(counts.get(l.id) ?? 0, expectedQty(l));
      return acc;
    },
    { expected: 0, received: 0 },
  );
  const pct = totals.expected ? Math.round((totals.received / totals.expected) * 100) : 0;

  async function manual(line: InvoiceLine) {
    const v = prompt(`Received quantity for "${line.description}" (invoice: ${expectedQty(line)})`, String(counts.get(line.id) ?? 0));
    if (v == null) return;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) await scanner.setManualCount(line, n);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="card p-4">
          <div className="flex items-baseline justify-between">
            <div className="text-sm text-slate-500">Received against invoice</div>
            <div className="text-sm tabular-nums text-slate-600">
              {totals.received} / {totals.expected} pcs
            </div>
          </div>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
          {active && (
            <form
              className="mt-4 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void scanner.handleCode(wedge);
                setWedge("");
              }}
            >
              <input
                ref={wedgeRef}
                className="input font-mono"
                placeholder="Scan with USB/Bluetooth scanner here, or type a barcode + Enter"
                value={wedge}
                onChange={(e) => setWedge(e.target.value)}
                autoFocus
              />
              <button className="btn-secondary">Add</button>
            </form>
          )}
          <ScanOutcomeBanner outcome={scanner.last} onUndo={scanner.undoLast} />
        </div>
        <div className="card flex flex-col items-center p-4 text-center">
          <div className="text-sm font-medium">Scan with a phone</div>
          {qr && <img src={qr} alt="QR code to open the scanner on a phone" className="my-2 h-40 w-40" />}
          <div className="text-xs text-slate-500">Sign in on the phone with the same ID, then scan this code — or open Scan → this invoice.</div>
          <button className="mt-2 text-xs text-brand-700 underline" onClick={() => navigator.clipboard?.writeText(scanUrl)}>
            Copy link
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th w-8">#</th>
              <th className="th">Item</th>
              <th className="th w-56">Progress</th>
              <th className="th w-28 text-right">Scanned</th>
              <th className="th w-32"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l) => {
              const c = counts.get(l.id) ?? 0;
              const e = expectedQty(l);
              const s = progressStyle(c, e);
              const lastHit = scanner.last?.kind === "counted" && scanner.last.line.id === l.id;
              return (
                <tr key={l.id} className={lastHit ? "bg-brand-50" : l.review_status === "recheck" ? "bg-rose-50/60" : ""}>
                  <td className="td text-slate-400">{l.line_no}</td>
                  <td className="td">
                    <div className="font-medium">{l.description}</div>
                    <div className="text-xs text-slate-500">
                      {l.is_loose ? "Loose — count manually" : l.item_id ? "" : "Not matched to stock — link by scanning"}
                      {l.review_status === "recheck" && <span className="text-rose-700"> · Re-scan requested{l.review_note ? `: ${l.review_note}` : ""}</span>}
                    </div>
                  </td>
                  <td className="td">
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full ${s.bar}`} style={{ width: `${Math.min(100, e ? (c / e) * 100 : 0)}%` }} />
                    </div>
                    <div className={`mt-0.5 text-xs ${s.text}`}>{s.label}</div>
                  </td>
                  <td className={`td text-right text-base font-semibold tabular-nums ${s.text}`}>
                    {c} <span className="text-sm font-normal text-slate-400">/ {e}</span>
                  </td>
                  <td className="td text-right">
                    {active && (
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => manual(l)}>
                        Set count
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {unmatchedScans.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 text-sm font-medium text-rose-800">Scanned but not on this invoice ({unmatchedScans.length})</div>
          <ul className="space-y-1 text-sm">
            {unmatchedScans.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="font-mono">{s.barcode}</span>
                <span className="text-xs text-slate-500">
                  {s.device_label} · {new Date(s.scanned_at).toLocaleTimeString("en-IN")}
                </span>
                {active && (
                  <button className="ml-auto text-xs text-slate-500 underline" onClick={() => scanner.undo(s.id)}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {scanner.pendingLink && (
        <LinkBarcodeModal
          barcode={scanner.pendingLink}
          lines={lines}
          counts={counts}
          onPick={(id) => {
            void scanner.linkToLine(id);
            wedgeRef.current?.focus();
          }}
          onNotOnInvoice={() => void scanner.markNotOnInvoice()}
          onCancel={() => scanner.setPendingLink(null)}
        />
      )}
    </div>
  );
}
