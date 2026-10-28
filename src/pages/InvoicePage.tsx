import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useInvoice, expectedQty } from "../lib/useInvoice";
import { audit, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { InvoiceStatus } from "../lib/types";
import StatusBadge from "../components/StatusBadge";
import HeaderCard from "../components/invoice/HeaderCard";
import ReviewTab from "../components/invoice/ReviewTab";
import ReceiveTab from "../components/invoice/ReceiveTab";
import ReconcileTab from "../components/invoice/ReconcileTab";
import ActivityTab from "../components/invoice/ActivityTab";

type Tab = "review" | "receive" | "reconcile" | "activity";

const STEPS: { status: InvoiceStatus[]; label: string }[] = [
  { status: ["review"], label: "1. Check invoice" },
  { status: ["receiving"], label: "2. Receive & scan" },
  { status: ["scanned"], label: "3. Manager review" },
  { status: ["approved", "exported"], label: "4. Export to Polosys" },
];

function defaultTab(status: InvoiceStatus | undefined): Tab {
  if (status === "receiving") return "receive";
  if (status === "scanned" || status === "approved" || status === "exported") return "reconcile";
  return "review";
}

export default function InvoicePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { isManager, session } = useAuth();
  const data = useInvoice(id, { live: true });
  const { invoice, lines, counts, loading, error, setInvoice } = data;
  const [tab, setTab] = useState<Tab>("review");
  const [tabChosen, setTabChosen] = useState(false);

  useEffect(() => {
    if (!tabChosen) setTab(defaultTab(invoice?.status));
  }, [invoice?.status, tabChosen]);

  if (loading) return <div className="text-sm text-slate-500">Loading…</div>;
  if (error || !invoice) return <div className="text-sm text-rose-700">{error ?? "Invoice not found"}</div>;

  const editable = invoice.status === "review" || invoice.status === "receiving";

  async function setStatus(status: InvoiceStatus, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    const { error } = await supabase.from("invoices").update({ status, updated_at: new Date().toISOString() }).eq("id", invoice!.id);
    if (error) return alert(error.message);
    if (status === "scanned") {
      // Re-scan requests are resolved once the clerk finishes scanning again
      await supabase.from("invoice_lines").update({ review_status: "ok" }).eq("invoice_id", invoice!.id).eq("review_status", "recheck");
    }
    await audit(`status_${status}`, "invoice", invoice!.id);
    setInvoice({ ...invoice!, status });
    setTabChosen(false);
  }

  async function startReceiving() {
    const zero = lines.filter((l) => !l.qty);
    const unmatched = lines.filter((l) => !l.item_id);
    const msgs = [
      !lines.length && "There are no lines.",
      zero.length && `${zero.length} line(s) have no quantity.`,
      unmatched.length && `${unmatched.length} line(s) are not matched to stock (you can link them by scanning).`,
    ].filter(Boolean);
    await setStatus("receiving", msgs.length ? `${msgs.join("\n")}\n\nStart receiving anyway?` : undefined);
  }

  async function finishScanning() {
    const short = lines.filter((l) => (counts.get(l.id) ?? 0) < expectedQty(l)).length;
    const over = lines.filter((l) => (counts.get(l.id) ?? 0) > expectedQty(l)).length;
    await setStatus(
      "scanned",
      short || over ? `${short} line(s) short and ${over} over. Finish scanning and send for approval?` : "Finish scanning and send for approval?",
    );
  }

  async function deleteInvoice() {
    if (!confirm("Delete this invoice and all its scans? This cannot be undone.")) return;
    if (invoice!.image_paths.length) await supabase.storage.from("invoices").remove(invoice!.image_paths);
    await audit("invoice_deleted", "invoice", invoice!.id, { invoice_no: invoice!.invoice_no, supplier: invoice!.supplier_name });
    await supabase.from("invoices").delete().eq("id", invoice!.id);
    nav("/");
  }

  const canDelete = ["draft", "review"].includes(invoice.status) && (isManager || invoice.created_by === session?.user.id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="text-sm text-slate-500 hover:underline">
          ← Invoices
        </Link>
        <h1 className="text-xl font-semibold">
          {invoice.supplier_name ?? "Invoice"} {invoice.invoice_no && <span className="text-slate-500">#{invoice.invoice_no}</span>}
        </h1>
        <StatusBadge status={invoice.status} />
        <div className="ml-auto flex flex-wrap gap-2">
          {invoice.status === "review" && (
            <button className="btn-primary" onClick={startReceiving}>
              Start receiving →
            </button>
          )}
          {invoice.status === "receiving" && (
            <>
              <button className="btn-secondary" onClick={() => setStatus("review")}>
                Back to checking
              </button>
              <button className="btn-primary" onClick={finishScanning}>
                Finish scanning →
              </button>
            </>
          )}
          {invoice.status === "scanned" && (
            <button className="btn-secondary" onClick={() => setStatus("receiving")}>
              Resume scanning
            </button>
          )}
          {canDelete && (
            <button className="btn-ghost text-rose-700" onClick={deleteInvoice}>
              Delete
            </button>
          )}
        </div>
      </div>

      <ol className="flex flex-wrap gap-2 text-xs">
        {STEPS.map((s) => {
          const current = s.status.includes(invoice.status);
          return (
            <li key={s.label} className={`rounded-full px-3 py-1 ${current ? "bg-brand-700 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200"}`}>
              {s.label}
            </li>
          );
        })}
      </ol>

      <HeaderCard invoice={invoice} lines={lines} editable={editable} onChange={(patch) => setInvoice((prev) => (prev ? { ...prev, ...patch } : prev))} />

      <div className="flex gap-1 border-b border-slate-200">
        {(
          [
            ["review", "Lines & price check"],
            ["receive", "Receive"],
            ["reconcile", "Reconciliation"],
            ["activity", "Activity"],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => {
              setTab(k);
              setTabChosen(true);
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-brand-700 font-medium text-brand-800" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "review" && <ReviewTab data={data} editable={editable} />}
      {tab === "receive" && <ReceiveTab data={data} active={invoice.status === "receiving"} />}
      {tab === "reconcile" && <ReconcileTab data={data} />}
      {tab === "activity" && <ActivityTab data={data} canUndo={invoice.status === "receiving"} />}
    </div>
  );
}
