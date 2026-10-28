// FR-8: export an approved invoice for import into Polosys.
// Polosys' import layout is still to be confirmed (BRD Q1), so this writes a clean,
// one-row-per-line purchase sheet plus MRP-batch and variance sheets. Adjust COLUMNS
// once the Polosys import template is known.
import * as XLSX from "xlsx";
import type { Invoice, InvoiceLine, Item } from "./types";
import { expectedQty } from "./useInvoice";
import { effectiveCost, lineTaxable, lineTotal, round2 } from "./validate";

export function exportInvoice(invoice: Invoice, lines: InvoiceLine[], items: Map<string, Item>, counts: Map<string, number>) {
  const purchase = lines.map((l) => {
    const item = l.item_id ? items.get(l.item_id) : undefined;
    const received = counts.get(l.id) ?? 0;
    const mrp = l.pack_mrp ?? l.mrp;
    return {
      "Inv No": invoice.invoice_no,
      "Inv Date": invoice.invoice_date,
      Supplier: invoice.supplier_name,
      "Supplier GSTIN": invoice.supplier_gstin,
      "Inward Ref": invoice.internal_ref,
      PCode: item?.pcode ?? "",
      Product: item?.name ?? l.description,
      "Invoice Description": l.description,
      HSN: l.hsn,
      "Billed Qty": l.qty,
      "Free Qty": l.free_qty,
      "Received Qty": received,
      MRP: mrp,
      "New MRP Batch": l.price_flag === "mrp_changed" ? "YES" : "",
      PRate: l.rate,
      "Disc %": l.discount_pct,
      "Disc Amt": l.discount_amt,
      "Sch Amt": l.scheme_amt,
      Taxable: round2(lineTaxable(l) ?? 0),
      "GST %": l.gst_pct,
      "Net Cost / Pc": effectiveCost(l) == null ? null : round2(effectiveCost(l)!),
      Total: round2(lineTotal(l) ?? 0),
      SRate: item?.srate ?? null,
      Batch: l.batch,
      Expiry: l.expiry,
    };
  });

  const batches = lines
    .filter((l) => l.price_flag === "mrp_changed" && l.item_id)
    .map((l) => {
      const item = items.get(l.item_id!)!;
      return {
        PCode: item.pcode,
        Product: item.name,
        "Old MRP": item.mrp,
        "Old Batch Qty (SOH)": item.stock,
        "New MRP": l.pack_mrp ?? l.mrp,
        "New Batch Qty": counts.get(l.id) ?? 0,
        Source: `${invoice.invoice_no} ${invoice.invoice_date ?? ""}`,
      };
    });

  const variance = lines.map((l) => {
    const received = counts.get(l.id) ?? 0;
    return {
      Line: l.line_no,
      Description: l.description,
      Expected: expectedQty(l),
      Received: received,
      Variance: received - expectedQty(l),
      Status: received === expectedQty(l) ? "OK" : received < expectedQty(l) ? "SHORT" : "EXCESS",
      "Price Flag": l.price_flag,
    };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(purchase), "Purchase");
  if (batches.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(batches), "MRP Batches");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(variance), "Variance");
  const safe = `${invoice.supplier_name ?? "invoice"}_${invoice.invoice_no ?? invoice.id.slice(0, 8)}`.replace(/[^\w.-]+/g, "_");
  XLSX.writeFile(wb, `${safe}.xlsx`);
}
