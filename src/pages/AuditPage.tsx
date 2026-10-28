import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

interface Row {
  id: number;
  at: string;
  user_id: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details: unknown;
}

/** NFR Auditability: every price change, approval and export with who and when. */
export default function AuditPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [filter, setFilter] = useState("");

  useEffect(() => {
    supabase
      .from("audit_log")
      .select("*")
      .order("at", { ascending: false })
      .limit(500)
      .then(({ data }) => setRows((data as Row[]) ?? []));
    supabase
      .from("profiles")
      .select("id,full_name")
      .then(({ data }) => setNames(new Map((data ?? []).map((p) => [p.id, p.full_name ?? "—"]))));
  }, []);

  const shown = rows.filter((r) => !filter || r.action.includes(filter));
  const actions = [...new Set(rows.map((r) => r.action))].sort();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Audit log</h1>
        <select className="input ml-auto w-auto" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">When</th>
              <th className="th">Who</th>
              <th className="th">Action</th>
              <th className="th">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="td whitespace-nowrap text-xs">{new Date(r.at).toLocaleString("en-IN")}</td>
                <td className="td">{names.get(r.user_id ?? "") ?? "system"}</td>
                <td className="td">
                  {r.entity === "invoice" && r.entity_id ? (
                    <Link to={`/invoices/${r.entity_id}`} className="text-brand-800 hover:underline">
                      {r.action.replace(/_/g, " ")}
                    </Link>
                  ) : (
                    r.action.replace(/_/g, " ")
                  )}
                </td>
                <td className="td max-w-md truncate text-xs text-slate-500" title={JSON.stringify(r.details)}>
                  {r.details ? JSON.stringify(r.details) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
