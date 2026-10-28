import { useEffect, useState } from "react";
import { searchItems, type SearchHit } from "../lib/match";
import { inr, num } from "../lib/util";

interface Props {
  storeId: string;
  initialQuery: string;
  onPick: (hit: SearchHit) => void;
  onClose: () => void;
}

export default function ItemPicker({ storeId, initialQuery, onPick, onClose }: Props) {
  const [q, setQ] = useState(initialQuery);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setHits([]);
    setLoading(true);
    const t = setTimeout(() => {
      searchItems(storeId, term, 15)
        .then(setHits)
        .catch(() => setHits([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, storeId]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onClick={onClose}>
      <div className="card w-full max-w-2xl p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <input autoFocus className="input" placeholder="Search item name or PCode" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {loading && <div className="p-3 text-sm text-slate-500">Searching…</div>}
          {!loading && hits.length === 0 && q.trim().length >= 2 && (
            <div className="p-3 text-sm text-slate-500">No match. Try fewer words, a brand, or the PCode.</div>
          )}
          <table className="w-full">
            <tbody className="divide-y divide-slate-100">
              {hits.map((h) => (
                <tr key={h.id} className="cursor-pointer hover:bg-brand-50" onClick={() => onPick(h)}>
                  <td className="td">
                    <div className="font-medium">{h.name}</div>
                    <div className="text-xs text-slate-500">PCode {h.pcode}</div>
                  </td>
                  <td className="td text-right text-xs text-slate-600">
                    <div>MRP {inr(h.mrp)}</div>
                    <div>Sale {inr(h.srate)}</div>
                  </td>
                  <td className="td text-right text-xs text-slate-600">
                    <div>Cost {inr(h.prate)}</div>
                    <div>Stock {num(h.stock)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
