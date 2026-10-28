import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { InvoiceData } from "../../lib/useInvoice";

interface AuditRow {
  id: number;
  at: string;
  user_id: string | null;
  action: string;
  details: unknown;
}

export default function ActivityTab({ data, canUndo }: { data: InvoiceData; canUndo: boolean }) {
  const { scans, lines, invoice } = data;
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id,full_name")
      .then(({ data }) => setNames(new Map((data ?? []).map((p) => [p.id, p.full_name ?? "—"]))));
    const lineIds = lines.map((l) => l.id);
    supabase
      .from("audit_log")
      .select("*")
      .or(`entity_id.eq.${invoice!.id}${lineIds.length ? `,entity_id.in.(${lineIds.join(",")})` : ""}`)
      .order("at", { ascending: false })
      .then(({ data }) => setAuditRows((data as AuditRow[]) ?? []));
  }, [invoice!.id, lines.length]);

  const lineName = new Map(lines.map((l) => [l.id, l.description]));
  const ordered = [...scans].reverse();

  async function undo(id: string, undone: boolean) {
    const { data: u } = await supabase.auth.getUser();
    data.setScans((prev) => prev.map((s) => (s.id === id ? { ...s, undone } : s)));
    await supabase.from("scans").update({ undone, undone_by: undone ? u.user?.id : null }).eq("id", id);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-2 text-sm font-medium">Scans ({scans.filter((s) => !s.undone).length})</div>
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full">
            <tbody className="divide-y divide-slate-100">
              {ordered.map((s) => (
                <tr key={s.id} className={s.undone ? "text-slate-400 line-through" : ""}>
                  <td className="td whitespace-nowrap text-xs">{new Date(s.scanned_at).toLocaleTimeString("en-IN")}</td>
                  <td className="td">
                    <div className="text-sm">{s.line_id ? lineName.get(s.line_id) : <span className="text-rose-700">Not on invoice</span>}</div>
                    <div className="text-xs text-slate-500">
                      {s.kind === "manual" ? `Manual ${s.qty > 0 ? "+" : ""}${s.qty}` : s.barcode} · {names.get(s.user_id ?? "") ?? "—"} · {s.device_label}
                    </div>
                  </td>
                  <td className="td text-right">
                    {canUndo && (
                      <button className="text-xs text-slate-500 underline hover:text-slate-800" onClick={() => undo(s.id, !s.undone)}>
                        {s.undone ? "Restore" : "Undo"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {ordered.length === 0 && (
                <tr>
                  <td className="td p-4 text-slate-500">No scans yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-2 text-sm font-medium">History</div>
        <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
          {auditRows.map((a) => (
            <li key={a.id} className="px-4 py-2 text-sm">
              <div>
                <span className="font-medium">{a.action.replace(/_/g, " ")}</span> · {names.get(a.user_id ?? "") ?? "system"}
              </div>
              <div className="text-xs text-slate-500">{new Date(a.at).toLocaleString("en-IN")}</div>
              {a.details != null && <pre className="mt-1 whitespace-pre-wrap text-xs text-slate-500">{JSON.stringify(a.details)}</pre>}
            </li>
          ))}
          {auditRows.length === 0 && <li className="p-4 text-sm text-slate-500">No history yet.</li>}
        </ul>
      </div>
    </div>
  );
}
