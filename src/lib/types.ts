export type Role = "clerk" | "manager" | "admin";

export interface Store {
  id: string;
  name: string;
  gstin: string | null;
  margin_threshold: number;
  cost_tolerance_pct: number;
}

export interface Profile {
  id: string;
  emp_code: string | null;
  full_name: string | null;
  role: Role;
  store_id: string | null;
  active: boolean;
}

export interface Item {
  id: string;
  store_id: string;
  pcode: string;
  name: string;
  stock: number | null;
  prate: number | null;
  srate: number | null;
  mrp: number | null;
  department: string | null;
  category: string | null;
  sub_category: string | null;
  brand: string | null;
}

export type InvoiceStatus = "draft" | "review" | "receiving" | "scanned" | "approved" | "exported" | "rejected";

export interface Invoice {
  id: string;
  store_id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_gstin: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  po_no: string | null;
  internal_ref: string | null;
  lf_no: string | null;
  irn: string | null;
  subtotal: number | null;
  tax_total: number | null;
  round_off: number | null;
  invoice_total: number | null;
  status: InvoiceStatus;
  image_paths: string[];
  extraction: unknown;
  validation: HeaderValidation | null;
  notes: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  exported_at: string | null;
  created_at: string;
}

export type PriceFlag = "ok" | "mrp_changed" | "cost_changed" | "sale_price_changed" | "new_item";

export interface InvoiceLine {
  id: string;
  invoice_id: string;
  line_no: number;
  item_code: string | null;
  description: string;
  hsn: string | null;
  uom: string | null;
  cases: number | null;
  pieces: number | null;
  units_per_case: number | null;
  qty: number;
  free_qty: number;
  mrp: number | null;
  rate: number | null;
  gross: number | null;
  discount_pct: number | null;
  discount_amt: number | null;
  scheme_amt: number | null;
  taxable: number | null;
  gst_pct: number | null;
  tax_amt: number | null;
  total: number | null;
  batch: string | null;
  expiry: string | null;
  item_id: string | null;
  match_source: string | null;
  pack_mrp: number | null;
  price_flag: PriceFlag | null;
  is_loose: boolean;
  review_status: "ok" | "recheck";
  review_note: string | null;
  warnings: string[];
  extract_note: string | null;
}

export interface Scan {
  id: string;
  invoice_id: string;
  line_id: string | null;
  barcode: string | null;
  qty: number;
  kind: "scan" | "manual";
  user_id: string | null;
  device_label: string | null;
  undone: boolean;
  scanned_at: string;
}

export interface HeaderValidation {
  lines_sum: number;
  expected_total: number | null;
  difference: number | null;
  ok: boolean;
  messages: string[];
}
