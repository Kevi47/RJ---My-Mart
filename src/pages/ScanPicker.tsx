import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Invoice } from "../lib/types";
import BarcodeScanner from "../components/BarcodeScanner";

/** Phone entry point: pick an invoice that is open for receiving, or scan the laptop's pairing QR. */
export default function ScanPicker() {
  const { store } = useAuth();
  const nav = useNavigate();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [pairing, setPairing] = useState(false);

  useEffect(() => {
    if (!store) return;
    supabase
      .from("invoices")
      .select("*")
      .eq("store_id", store.id)
      .eq("status", "receiving")
      .order("updated_at", { ascending: false })
      .then(({ data }) => setInvoices((data as Invoice[]) ?? []));
  }, [store?.id]);

  function onPairCode(text: string) {
    const m = text.match(/\/scan\/([0-9a-f-]{36})/i);
    if (m) nav(`/scan/${m[1]}`);
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-semibold">Join a receiving session</h1>
      <button className="btn-primary w-full" onClick={() => setPairing((p) => !p)}>
        {pairing ? "Cancel" : "Scan pairing QR from laptop"}
      </button>
      {pairing && <BarcodeScanner className="aspect-square w-full" onDetect={onPairCode} />}
      <div className="card divide-y divide-slate-100">
        {invoices.map((i) => (
          <Link key={i.id} to={`/scan/${i.id}`} className="block px-4 py-3 hover:bg-slate-50">
            <div className="font-medium">{i.supplier_name ?? "Invoice"}</div>
            <div className="text-xs text-slate-500">
              #{i.invoice_no} · {i.invoice_date}
            </div>
          </Link>
        ))}
        {invoices.length === 0 && <div className="p-4 text-sm text-slate-500">No invoices are open for receiving. Start one on the laptop.</div>}
      </div>
    </div>
  );
}
