import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useInvoice, expectedQty } from "../lib/useInvoice";
import { useScanner } from "../lib/useScanner";
import { onQueueChange, pendingCount } from "../lib/scanQueue";
import BarcodeScanner from "../components/BarcodeScanner";
import LinkBarcodeModal from "../components/invoice/LinkBarcodeModal";
import ScanOutcomeBanner from "../components/invoice/ScanOutcomeBanner";
import { progressStyle } from "../components/invoice/ReceiveTab";

/** FR-14: phone joins the receiving session and acts as the scanner. */
export default function ScanPage() {
  const { id } = useParams();
  const { store, session } = useAuth();
  const data = useInvoice(id, { live: true });
  const scanner = useScanner(data, store?.id, session?.user.id);
  const [camera, setCamera] = useState(true);
  const [pending, setPending] = useState(pendingCount());
  const [online, setOnline] = useState(navigator.onLine);
  const [wedge, setWedge] = useState("");
  const [showAll, setShowAll] = useState(false);
  const wedgeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const off = onQueueChange(setPending);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      off();
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const { invoice, lines, counts, loading } = data;
  if (loading) return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  if (!invoice) return <div className="p-6 text-sm text-rose-700">Invoice not found.</div>;

  const active = invoice.status === "receiving";
  const done = lines.filter((l) => (counts.get(l.id) ?? 0) === expectedQty(l)).length;
  const remaining = lines.filter((l) => (counts.get(l.id) ?? 0) !== expectedQty(l));
  const listed = showAll ? lines : remaining;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-slate-50">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <Link to="/scan" className="text-sm text-slate-500">
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{invoice.supplier_name}</div>
          <div className="text-xs text-slate-500">
            #{invoice.invoice_no} · {done}/{lines.length} lines complete
          </div>
        </div>
        <span className={`badge ${online ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
          {online ? (pending ? `Syncing ${pending}` : "Live") : `Offline · ${pending} queued`}
        </span>
      </header>

      {!active ? (
        <div className="m-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          This invoice is not open for receiving (status: {invoice.status}). Start receiving on the laptop first.
        </div>
      ) : (
        <div className="space-y-3 p-3">
          {camera && <BarcodeScanner className="aspect-[4/3] w-full" onDetect={(code) => void scanner.handleCode(code)} paused={!!scanner.pendingLink} />}
          <div className="flex gap-2">
            <button className="btn-secondary flex-1" onClick={() => setCamera((c) => !c)}>
              {camera ? "Camera off" : "Camera on"}
            </button>
            <button className="btn-secondary flex-1" onClick={() => void scanner.undoLast()}>
              Undo last
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void scanner.handleCode(wedge);
              setWedge("");
            }}
            className="flex gap-2"
          >
            <input
              ref={wedgeRef}
              className="input font-mono"
              inputMode={camera ? "numeric" : "none"}
              placeholder={camera ? "Type barcode…" : "Bluetooth scanner input"}
              value={wedge}
              onChange={(e) => setWedge(e.target.value)}
              autoFocus={!camera}
            />
            <button className="btn-secondary">Add</button>
          </form>
          <ScanOutcomeBanner outcome={scanner.last} large onUndo={scanner.undoLast} />
        </div>
      )}

      <div className="flex-1 px-3 pb-6">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-medium">{showAll ? "All lines" : `Remaining (${remaining.length})`}</div>
          <button className="text-xs text-brand-700 underline" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "Show remaining" : "Show all"}
          </button>
        </div>
        <ul className="space-y-1.5">
          {listed.map((l) => {
            const c = counts.get(l.id) ?? 0;
            const e = expectedQty(l);
            const s = progressStyle(c, e);
            return (
              <li key={l.id} className="card flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{l.description}</div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full ${s.bar}`} style={{ width: `${Math.min(100, e ? (c / e) * 100 : 0)}%` }} />
                  </div>
                  {l.is_loose && <div className="text-xs text-slate-500">Loose — count on the laptop</div>}
                </div>
                <div className={`text-right text-lg font-semibold tabular-nums ${s.text}`}>
                  {c}
                  <span className="text-xs font-normal text-slate-400">/{e}</span>
                </div>
              </li>
            );
          })}
          {listed.length === 0 && <li className="p-4 text-center text-sm text-emerald-700">All lines match the invoice ✓</li>}
        </ul>
      </div>

      {scanner.pendingLink && (
        <LinkBarcodeModal
          barcode={scanner.pendingLink}
          lines={lines}
          counts={counts}
          onPick={(lineId) => void scanner.linkToLine(lineId)}
          onNotOnInvoice={() => void scanner.markNotOnInvoice()}
          onCancel={() => scanner.setPendingLink(null)}
        />
      )}
    </div>
  );
}
