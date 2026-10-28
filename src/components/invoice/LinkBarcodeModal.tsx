import { useState } from "react";
import type { InvoiceLine } from "../../lib/types";
import { expectedQty } from "../../lib/useInvoice";

interface Props {
  barcode: string;
  lines: InvoiceLine[];
  counts: Map<string, number>;
  onPick: (lineId: string) => void;
  onNotOnInvoice: () => void;
  onCancel: () => void;
}

/** FR-10: first time a barcode is seen, the clerk says which invoice line it belongs to. */
export default function LinkBarcodeModal({ barcode, lines, counts, onPick, onNotOnInvoice, onCancel }: Props) {
  const [q, setQ] = useState("");
  const shown = lines.filter((l) => !q || l.description.toLowerCase().includes(q.toLowerCase()));
  // Lines without a known barcode yet and still short are the likeliest candidates.
  const sorted = [...shown].sort((a, b) => {
    const ra = expectedQty(a) - (counts.get(a.id) ?? 0) > 0 ? 0 : 1;
    const rb = expectedQty(b) - (counts.get(b.id) ?? 0) > 0 ? 0 : 1;
    return ra - rb || a.line_no - b.line_no;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
      <div className="card max-h-[85vh] w-full max-w-lg overflow-hidden rounded-b-none sm:rounded-b-xl">
        <div className="border-b border-slate-200 p-4">
          <div className="text-sm text-slate-500">New barcode</div>
          <div className="font-mono text-lg font-semibold">{barcode}</div>
          <div className="mt-1 text-sm text-slate-600">Which invoice line is this product? It will be remembered next time.</div>
          <input className="input mt-3" placeholder="Filter lines…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {sorted.map((l) => {
            const c = counts.get(l.id) ?? 0;
            return (
              <button key={l.id} className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-brand-50" onClick={() => onPick(l.id)}>
                <span className="w-6 text-xs text-slate-400">{l.line_no}</span>
                <span className="flex-1 text-sm font-medium">{l.description}</span>
                <span className="text-sm tabular-nums text-slate-500">
                  {c}/{expectedQty(l)}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex gap-2 p-3">
          <button className="btn-secondary flex-1" onClick={onNotOnInvoice}>
            Not on this invoice
          </button>
          <button className="btn-ghost flex-1" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
