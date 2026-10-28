import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Invoice, InvoiceStatus } from "../lib/types";
import { inr } from "../lib/util";
import StatusBadge from "../components/StatusBadge";

const FILTERS: { key: "open" | InvoiceStatus | "all"; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "review", label: "To review" },
  { key: "receiving", label: "Receiving" },
  { key: "scanned", label: "Awaiting approval" },
  { key: "approved", label: "Approved" },
  { key: "exported", label: "Exported" },
  { key: "all", label: "All" },
];

export default function Dashboard() {
  const { store } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("open");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!store) return;
    setLoading(true);
    supabase
      .from("invoices")
      .select("*")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        setInvoices((data as Invoice[]) ?? []);
        setLoading(false);
      });
  }, [store?.id]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return invoices.filter((i) => {
      if (filter === "open" && ["approved", "exported", "rejected"].includes(i.status)) return false;
      if (filter !== "open" && filter !== "all" && i.status !== filter) return false;
      if (!term) return true;
      return [i.supplier_name, i.invoice_no, i.internal_ref, i.lf_no].some((v) => v?.toLowerCase().includes(term));
    });
  }, [invoices, filter, q]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of invoices) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [invoices]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Invoices</h1>
        <div className="ml-auto flex gap-2">
          <Link to="/scan" className="btn-secondary">
            Join scan on phone
          </Link>
          <Link to="/invoices/new" className="btn-primary">
            + New invoice
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["review", "To review"],
          ["receiving", "Receiving"],
          ["scanned", "Awaiting approval"],
          ["approved", "Ready to export"],
        ].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k as InvoiceStatus)} className="card p-3 text-left hover:border-brand-600">
            <div className="text-2xl font-semibold tabular-nums">{counts[k] ?? 0}</div>
            <div className="text-xs text-slate-500">{label}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1 text-sm ${filter === f.key ? "bg-brand-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input className="input ml-auto max-w-xs" placeholder="Search supplier, invoice no, ref…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Date</th>
              <th className="th">Supplier</th>
              <th className="th">Invoice no</th>
              <th className="th">Ref / LF</th>
              <th className="th text-right">Total</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td className="td text-slate-500" colSpan={6}>
                  Loading…
                </td>
              </tr>
            )}
            {!loading && shown.length === 0 && (
              <tr>
                <td className="td py-8 text-center text-slate-500" colSpan={6}>
                  No invoices here. <Link to="/invoices/new" className="text-brand-700 underline">Add one</Link>.
                </td>
              </tr>
            )}
            {shown.map((i) => (
              <tr key={i.id} className="hover:bg-slate-50">
                <td className="td whitespace-nowrap">{i.invoice_date ?? new Date(i.created_at).toLocaleDateString("en-IN")}</td>
                <td className="td">
                  <Link to={`/invoices/${i.id}`} className="font-medium text-brand-800 hover:underline">
                    {i.supplier_name ?? "Unknown supplier"}
                  </Link>
                </td>
                <td className="td">{i.invoice_no ?? "—"}</td>
                <td className="td text-slate-500">
                  {i.internal_ref ?? "—"}
                  {i.lf_no ? ` / LF-${i.lf_no}` : ""}
                </td>
                <td className="td text-right tabular-nums">{inr(i.invoice_total)}</td>
                <td className="td">
                  <StatusBadge status={i.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
