import { z } from "zod";

const num = z.number().nullable();
const str = z.string().nullable();

export const ExtractedLine = z.object({
  line_no: z.number(),
  item_code: str.describe("Supplier's product/item code if printed, else null"),
  description: z.string(),
  hsn: str,
  uom: str.describe("Unit as printed: NOS, EA, BTL, PCS, CS, KG ..."),
  cases: num.describe("Number of cases/cartons if the invoice has a cases column"),
  pieces: num.describe("Loose pieces if the invoice splits cases and pieces"),
  units_per_case: num.describe("Units per case (UPC) if printed"),
  qty: z.number().describe("Total billed quantity normalised to single pieces/units"),
  free_qty: num,
  mrp: num.describe("MRP per piece as printed (column or sub-line such as 'MRP/Marginal: 75.00/NOS'); null if absent"),
  rate: num.describe("Per-piece rate BEFORE discount and EXCLUDING GST"),
  rate_incl_tax: num.describe("Per-piece rate including tax, only if a separate column prints it"),
  gross: num.describe("qty x rate before discount"),
  discount_pct: num,
  discount_amt: num.describe("Discount amount in rupees for the line (from Disc column), excluding scheme"),
  scheme_amt: num.describe("Scheme / SCH amount in rupees for the line"),
  taxable: num.describe("Taxable value of the line after discounts"),
  gst_pct: num.describe("Total GST % (CGST + SGST, or IGST)"),
  tax_amt: num.describe("Total GST amount for the line"),
  total: num.describe("Line total including tax, if printed"),
  batch: str,
  expiry: str,
  handwritten_note: str.describe("Any handwritten correction or mark on this line (e.g. a struck-out quantity)"),
  confidence: z.enum(["high", "medium", "low"]),
});

export const ExtractedInvoice = z.object({
  supplier_name: str,
  supplier_gstin: str,
  buyer_name: str,
  buyer_gstin: str,
  invoice_no: str,
  invoice_date: str.describe("ISO date YYYY-MM-DD"),
  po_no: str.describe("Buyer's order / PO / reference number"),
  irn: str.describe("e-invoice IRN if printed"),
  internal_ref: str.describe("Handwritten circled number on the invoice (store inward number)"),
  lf_no: str.describe("Handwritten 'LF-' number, digits only"),
  line_amounts_include_tax: z
    .boolean()
    .describe("true if the per-line amount column already includes GST; false if GST is added below the lines"),
  subtotal: num.describe("Sum of line amounts before invoice-level tax rows"),
  tax_total: num,
  round_off: num.describe("Signed round-off, e.g. -0.09"),
  invoice_total: num.describe("Final payable amount"),
  lines: z.array(ExtractedLine),
  notes: z.array(z.string()).describe("Anything unclear, illegible, or suspicious the clerk should check"),
});

export type ExtractedInvoice = z.infer<typeof ExtractedInvoice>;
export type ExtractedLine = z.infer<typeof ExtractedLine>;
