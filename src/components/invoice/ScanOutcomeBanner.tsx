import type { ScanOutcome } from "../../lib/useScanner";

export default function ScanOutcomeBanner({ outcome, onUndo, large }: { outcome: ScanOutcome | null; onUndo?: () => void; large?: boolean }) {
  if (!outcome) return null;
  const size = large ? "p-4" : "mt-3 p-3";
  if (outcome.kind === "counted") {
    const tone = outcome.over ? "bg-rose-600 text-white" : outcome.count === outcome.expected ? "bg-emerald-600 text-white" : "bg-brand-700 text-white";
    return (
      <div className={`rounded-xl ${size} ${tone}`}>
        <div className={`font-medium ${large ? "text-lg" : "text-sm"}`}>{outcome.line.description}</div>
        <div className="flex items-end justify-between">
          <div className={`${large ? "text-4xl" : "text-2xl"} font-bold tabular-nums`}>
            {outcome.count} <span className="text-base font-normal opacity-80">of {outcome.expected}</span>
          </div>
          {onUndo && (
            <button className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-medium" onClick={onUndo}>
              Undo
            </button>
          )}
        </div>
        {outcome.over && <div className="mt-1 text-sm font-semibold">Over invoice quantity — set aside and check</div>}
      </div>
    );
  }
  if (outcome.kind === "not_on_invoice") {
    return (
      <div className={`rounded-xl bg-rose-600 text-white ${size}`}>
        <div className="font-semibold">Not on this invoice</div>
        <div className="text-sm opacity-90">
          {outcome.item ? outcome.item.name : "Unknown product"} · <span className="font-mono">{outcome.barcode}</span>
        </div>
        {onUndo && (
          <button className="mt-2 rounded-lg bg-white/20 px-3 py-1 text-sm" onClick={onUndo}>
            Undo
          </button>
        )}
      </div>
    );
  }
  if (outcome.kind === "unknown") {
    return (
      <div className={`rounded-xl bg-amber-500 text-white ${size}`}>
        <div className="font-semibold">New barcode — choose the line</div>
        <div className="font-mono text-sm">{outcome.barcode}</div>
      </div>
    );
  }
  return <div className={`rounded-xl bg-rose-100 text-rose-800 ${size}`}>{outcome.message}</div>;
}
