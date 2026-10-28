import type { InvoiceStatus } from "../lib/types";

const STYLE: Record<InvoiceStatus, [string, string]> = {
  draft: ["Draft", "bg-slate-100 text-slate-700"],
  review: ["To review", "bg-amber-100 text-amber-900"],
  receiving: ["Receiving", "bg-sky-100 text-sky-800"],
  scanned: ["Awaiting approval", "bg-violet-100 text-violet-800"],
  approved: ["Approved", "bg-emerald-100 text-emerald-800"],
  exported: ["Exported", "bg-emerald-600 text-white"],
  rejected: ["Rejected", "bg-rose-100 text-rose-800"],
};

export default function StatusBadge({ status }: { status: InvoiceStatus }) {
  const [label, cls] = STYLE[status];
  return <span className={`badge ${cls}`}>{label}</span>;
}
