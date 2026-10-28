// FR-1: parse a Polosys "Stock Report" export (xlsx/xls/csv) into item rows.
import * as XLSX from "xlsx";

export interface SohRow {
  pcode: string;
  name: string;
  stock: number | null;
  prate: number | null;
  srate: number | null;
  mrp?: number | null;
  barcode?: string | null;
  hsn?: string | null;
  department: string | null;
  category: string | null;
  sub_category: string | null;
  brand: string | null;
}

export interface SohParseResult {
  rows: SohRow[];
  asOnDate: string | null;
  hasMrp: boolean;
  hasBarcode: boolean;
  skipped: number;
}

const toNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const toStr = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s && s !== "." ? s : null;
};

// Header aliases → field. Matching is case/space-insensitive.
const ALIASES: Record<string, string[]> = {
  sub_category: ["subcategory"],
  name: ["product", "productname", "itemname", "description", "item"],
  stock: ["stock", "qty", "quantity", "soh", "closingstock"],
  prate: ["prate", "purchaserate", "cost", "lastpurchasecost"],
  srate: ["srate", "salerate", "salesrate", "sellingprice"],
  mrp: ["mrp"],
  pcode: ["pcode", "productcode", "itemcode", "code"],
  barcode: ["barcode", "ean", "eancode"],
  hsn: ["hsn", "hsncode"],
  department: ["department"],
  category: ["category"],
  brand: ["brandname", "brand"],
};

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");

export async function parseSohFile(file: File): Promise<SohParseResult> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });

  let asOnDate: string | null = null;
  let headerIdx = -1;
  const col: Record<string, number> = {};
  for (let i = 0; i < Math.min(grid.length, 40); i++) {
    const row = grid[i] ?? [];
    const text = row.map((c) => String(c ?? "")).join(" ");
    const m = text.match(/As On Date\s*:?\s*([0-9]{1,2}\/[A-Za-z0-9]{2,3}\/[0-9]{2,4})/i);
    if (m) asOnDate = m[1];
    const keys = row.map(norm);
    if (keys.some((k) => ALIASES.pcode.includes(k)) && keys.some((k) => ALIASES.name.includes(k))) {
      headerIdx = i;
      keys.forEach((k, idx) => {
        for (const [field, aliases] of Object.entries(ALIASES)) {
          if (aliases.includes(k) && col[field] == null) col[field] = idx;
        }
      });
      break;
    }
  }
  if (headerIdx < 0) throw new Error("Could not find the header row (needs Product and PCode columns).");

  const rows: SohRow[] = [];
  let currentSub: string | null = null;
  let skipped = 0;
  const get = (r: unknown[], f: string) => (col[f] == null ? null : r[col[f]]);

  for (const r of grid.slice(headerIdx + 1)) {
    if (!r) continue;
    const name = toStr(get(r, "name"));
    const sub = toStr(get(r, "sub_category"));
    if (sub && !name) {
      currentSub = sub; // group heading row
      continue;
    }
    const pcode = toStr(get(r, "pcode"));
    if (!name || !pcode || /^(group )?total$/i.test(name) || norm(name) === "product") {
      if (name) skipped++;
      continue;
    }
    const row: SohRow = {
      pcode,
      name,
      stock: toNum(get(r, "stock")),
      prate: toNum(get(r, "prate")),
      srate: toNum(get(r, "srate")),
      department: toStr(get(r, "department")),
      category: toStr(get(r, "category")),
      sub_category: sub ?? currentSub,
      brand: toStr(get(r, "brand")),
    };
    if (col.mrp != null) row.mrp = toNum(get(r, "mrp"));
    if (col.barcode != null) row.barcode = toStr(get(r, "barcode"));
    if (col.hsn != null) row.hsn = toStr(get(r, "hsn"));
    rows.push(row);
  }

  // Polosys can list the same code twice; keep the last occurrence.
  const byCode = new Map(rows.map((r) => [r.pcode, r]));
  return {
    rows: [...byCode.values()],
    asOnDate,
    hasMrp: col.mrp != null,
    hasBarcode: col.barcode != null,
    skipped: skipped + (rows.length - byCode.size),
  };
}
