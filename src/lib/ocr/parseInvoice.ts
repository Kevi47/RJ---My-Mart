// Turns Tesseract OCR lines into the same ExtractedInvoice shape the AI reader returns.
// Plain OCR has no idea which number is qty, rate or amount, so each line is solved
// arithmetically (qty × rate ≈ amount, optionally after a discount %) and anything that
// cannot be solved is left for the clerk with a low-confidence flag.
import type { ExtractedInvoice, ExtractedLine } from "../../../api/_lib/extractSchema";

export interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface OcrWord {
  text: string;
  conf: number;
  bbox: OcrBox;
}
export interface OcrLine {
  words: OcrWord[];
  bbox: OcrBox;
}

interface Tok {
  raw: string;
  text: string; // cleaned
  num: number | null; // value as printed
  alt: number[]; // other plausible values (lost decimal point, split decimals)
  pct: boolean;
  unitAfter: boolean; // number immediately followed by a unit like NOS
  fracOf?: Tok; // the "50" of "62 50": decimals of the previous number
  conf: number;
}

const UNITS = /^(NOS?|BTL|BTLS|PCS?|EA|KGS?|PKT|PKTS|BOX|CS|CTN|BAG|LTRS?|DOZ|SET)\.?$/i;
const SUMMARY = /\b(total|cgst|sgst|igst|round|taxable value|amount chargeable|bank|payable|grand|in words|rupees|discount amount|total tax|e\s*&\s*o\.?e)\b/i;
const HEADER_WORDS = /\b(qty|quantity|rate|amount|amt|hsn|description|particulars|mrp|disc|gst|item|product|commodity|uom|unit)\b/gi;
const GST_HALF = [2.5, 6, 9, 14];
const GST_FULL = [0, 5, 12, 18, 28];
const near = (a: number, b: number, abs = 0.6, rel = 0.006) => Math.abs(a - b) <= Math.max(abs, Math.abs(b) * rel);
const round2 = (n: number) => Math.round(n * 100) / 100;

function toNumber(core: string): { v: number; dot: boolean } | null {
  let s = core.replace(/^[^\dA-Za-z(-]+|[^\dA-Za-z]+$/g, "");
  if (!s) return null;
  // Only O/o/l/I may stand in for digits; any other letter means this is a word ("52.9Gr", "Rs20", "6P")
  if (/[A-HJ-NP-Za-km-np-z]/.test(s)) return null;
  if ((s.match(/[OolI]/g)?.length ?? 0) > (s.match(/\d/g)?.length ?? 0)) return null;
  s = s.replace(/[Oo]/g, "0").replace(/[lI]/g, "1").replace(/[()]/g, "");
  if (!/^-?[\d,]*\.?\d+$/.test(s)) return null;
  const v = Number(s.replace(/,/g, ""));
  return Number.isFinite(v) ? { v, dot: s.includes(".") } : null;
}

function tokenize(line: OcrLine): Tok[] {
  const toks: Tok[] = [];
  for (const w of line.words) {
    // Table borders are often read as | [ ] — split on them
    for (const part of w.text.split(/[|[\]{}]+/)) {
      const raw = part.trim();
      if (!raw) continue;
      const text = raw.replace(/^[,;:'"`]+|[,;:'"`_]+$/g, "");
      if (!text) continue;
      const pct = /%$/.test(text);
      const unitMerged = text.match(/^(\d+(?:\.\d+)?)(NOS?|BTL|PCS?|EA|KG|PKT)$/i);
      const n = unitMerged ? { v: Number(unitMerged[1]), dot: false } : toNumber(text.replace(/%$/, "").replace(/\/(NOS?|BTL|PCS|EA)$/i, ""));
      const alt: number[] = [];
      if (n && !n.dot && !pct && Math.abs(n.v) >= 100 && Number.isInteger(n.v)) alt.push(n.v / 100);
      toks.push({ raw, text, num: n?.v ?? null, alt, pct, unitAfter: Boolean(unitMerged), conf: w.conf });
    }
  }
  // "62 50" → 62.50 when a decimal point was read as a space
  for (let i = 0; i + 1 < toks.length; i++) {
    const a = toks[i];
    const b = toks[i + 1];
    if (a.num != null && b.num != null && Number.isInteger(a.num) && /^\d{2}$/.test(b.text) && !a.text.includes(".")) {
      a.alt.push(a.num + b.num / 100);
      b.fracOf = a;
    }
  }
  for (let i = 0; i + 1 < toks.length; i++) if (toks[i].num != null && UNITS.test(toks[i + 1].text)) toks[i].unitAfter = true;
  return toks;
}

const hasLetters = (t: Tok) => (t.text.match(/[A-Za-z]/g)?.length ?? 0) >= 2 && t.num == null;
const lineText = (l: OcrLine) => l.words.map((w) => w.text).join(" ");
const values = (t: Tok) => (t.num == null ? [] : [t.num, ...t.alt]);
const isHsn = (t: Tok) => t.num != null && !t.pct && /^\d{5,8}$/.test(t.text.replace(/[^\d]+$/, ""));

interface ParsedLine {
  line: ExtractedLine;
  solved: boolean;
}

function parseItemLine(toks: Tok[], lineNo: number): ParsedLine | null {
  // Description = span of word tokens; numbers before it are the serial no. and/or MRP
  const firstWord = toks.findIndex((t) => hasLetters(t) && !UNITS.test(t.text));
  if (firstWord < 0) return null;
  let lastWord = firstWord;
  for (let i = firstWord + 1; i < toks.length; i++) {
    const t = toks[i];
    if (t.pct || (UNITS.test(t.text) && toks[i - 1].num != null)) break;
    if (t.num != null && (isHsn(t) || t.text.includes("."))) break;
    if (hasLetters(t)) lastWord = i;
  }
  let rest = toks.slice(lastWord + 1);
  const descToks = toks.slice(firstWord, lastWord + 1);
  // Numbers between the description and the HSN are pack size / printed price ("Rs 20")
  const hsnIdx = rest.findIndex(isHsn);
  if (hsnIdx > 0 && rest.slice(0, hsnIdx).every((t) => !t.pct && !t.unitAfter)) {
    descToks.push(...rest.slice(0, hsnIdx));
    rest = rest.slice(hsnIdx);
  }
  const description = descToks
    .map((t) => t.raw)
    .join(" ")
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/[_|]+$/g, "")
    .trim();
  if (description.replace(/[^A-Za-z]/g, "").length < 3) return null;

  // "7 | 20 00|NAUGHTY…" → serial 7, MRP 20.00; a lone integer is just the serial
  let before = toks.slice(0, firstWord).filter((t) => t.num != null);
  if (before.length >= 2 || (before.length === 1 && !before[0].text.includes("."))) before = before.slice(1);
  const mrpTok: Tok | null = before[0] ?? null;

  let hsn: string | null = null;
  let gst: number | null = null;
  let discPct: number | null = null;
  let qty: number | null = null;
  let unit: string | null = null;
  const nums: Tok[] = [];

  for (const t of rest) {
    if (t.num == null) {
      if (UNITS.test(t.text) && !unit) unit = t.text.toUpperCase().replace(/\.$/, "");
      continue;
    }
    if (!hsn && isHsn(t)) {
      hsn = t.text.replace(/\D/g, "");
      continue;
    }
    if (t.pct) {
      if (gst == null && GST_FULL.includes(t.num)) gst = t.num;
      else if (t.num > 0 && t.num <= 60) discPct = t.num;
      continue;
    }
    if (t.unitAfter && qty == null && Number.isInteger(t.num)) {
      qty = t.num;
      const m = t.text.match(/[A-Za-z]+$/);
      if (m) unit = m[0].toUpperCase();
      continue;
    }
    nums.push(t);
  }

  // CGST/SGST rate printed as an equal pair: "2.50 2.50" or "250 250"
  for (let i = 0; i + 1 < nums.length && gst == null; i++) {
    const v = values(nums[i]).find((x) => GST_HALF.includes(x) && values(nums[i + 1]).includes(x));
    if (v != null) {
      gst = v * 2;
      nums.splice(i, 2);
    }
  }

  // Solve qty × rate ≈ amount (or amount after discount %)
  const factor = discPct ? 1 - discPct / 100 : 1;
  const qtyCands: { t: Tok | null; v: number }[] =
    qty != null
      ? [{ t: null, v: qty }]
      : nums
          .filter((t) => !t.fracOf && t.num! > 0 && t.num! <= 5000 && Number.isInteger(t.num))
          // "10.00" read as "1000": try the qty both ways
          .flatMap((t) => [{ t, v: t.num! }, ...(/^\d+00$/.test(t.text) ? [{ t, v: t.num! / 100 }] : [])]);
  let best: { q: number; r: number; amt: number; net: boolean; used: Tok[]; score: number } | null = null;
  for (const qc of qtyCands) {
    const qi = qc.t ? nums.indexOf(qc.t) : -1;
    for (let j = qi + 1; j < nums.length; j++) {
      for (const r of values(nums[j])) {
        if (r <= 0) continue;
        for (let k = j + 1; k < nums.length; k++) {
          for (const g of values(nums[k])) {
            const gross = qc.v * r;
            const net = !near(gross, g) && factor !== 1 && near(gross * factor, g);
            if (!net && !near(gross, g)) continue;
            const score =
              10 - (k - j) - (qi >= 0 ? (j - qi) * 0.5 : 0) + (r === nums[j].num ? 1 : 0) + (g === nums[k].num ? 1 : 0) - (qc.v >= 100 ? 2 : 0);
            if (!best || score > best.score) best = { q: qc.v, r, amt: g, net, used: [nums[j], nums[k], ...(qc.t ? [qc.t] : [])], score };
          }
        }
      }
    }
  }

  let rate: number | null = null;
  let gross: number | null = null;
  let taxable: number | null = null;
  let solved = false;
  let amountTok: Tok | null = null;
  const notes: string[] = [];
  let leftover = nums;
  const drop = (used: Tok[]) => (leftover = leftover.filter((t) => !used.includes(t) && !(t.fracOf && used.includes(t.fracOf))));
  if (best) {
    qty = best.q;
    rate = best.r;
    gross = round2(best.q * best.r);
    if (best.net) taxable = best.amt;
    solved = true;
    amountTok = best.used[1];
    drop(best.used);
  } else if (qty != null) {
    // Qty known from its unit; take the first price-looking number as the rate and derive the amount
    const r = nums.find((t) => t.text.includes(".") || t.alt.length > 0);
    if (r) {
      rate = r.text.includes(".") ? r.num : (r.alt.find((a) => a % 1 !== 0) ?? r.num);
      gross = round2(qty * rate!);
      notes.push("Amount unreadable — calculated from qty × rate");
      drop([r]);
    }
  }

  let discAmt: number | null = null;
  let total: number | null = null;
  let taxAmt: number | null = null;
  if (gross != null) {
    const afterPct = taxable ?? round2(gross * factor);
    // Per-line tax amounts (taxable × p%) reveal the GST rate when no % is printed
    const taxHit = (base: number) => {
      for (const t of leftover)
        for (const v of values(t)) {
          const half = GST_HALF.find((p) => near(base * (p / 100), v, 0.05, 0.01));
          if (half != null) return { t, gst: half * 2 };
          const full = GST_FULL.find((p) => p > 0 && near(base * (p / 100), v, 0.05, 0.01));
          if (full != null) return { t, gst: full };
        }
      return null;
    };
    if (!discPct && amountTok) {
      // A rupee discount usually sits right after the amount; skip it if it is really a tax figure
      const next = nums.slice(nums.indexOf(amountTok) + 1).find((t) => t.fracOf !== amountTok);
      if (next && leftover.includes(next) && taxHit(afterPct)?.t !== next) {
        const v = values(next).find((x) => x > 0 && x < gross! * 0.35 && !GST_HALF.includes(x) && !GST_FULL.includes(x));
        if (v != null) {
          discAmt = v;
          drop([next]);
        }
      }
    }
    taxable = round2(afterPct - (discAmt ?? 0));
    if (gst == null) gst = taxHit(taxable)?.gst ?? null;
    const expectedTotal = round2(taxable * (1 + (gst ?? 0) / 100));
    const totTok = [...leftover].reverse().find((t) => values(t).some((v) => near(v, expectedTotal, 0.6, 0.004)));
    if (totTok) total = values(totTok).find((v) => near(v, expectedTotal, 0.6, 0.004))!;
    if (gst != null) taxAmt = round2(taxable * (gst / 100));
  }

  // Every decimal point lost the same way (17.32 → 1732, 103.92 → 10392) still multiplies out;
  // a rate far above the printed MRP gives it away
  const mrpPrinted = mrpTok ? Math.min(...values(mrpTok)) : null;
  if (solved && rate != null && mrpPrinted && rate >= 100 && rate > mrpPrinted * 1.5 && rate / 100 <= mrpPrinted * 1.1) {
    rate = round2(rate / 100);
    gross = round2(gross! / 100);
    taxable = round2(taxable! / 100);
    if (discAmt != null && discAmt >= 1) discAmt = round2(discAmt / 100);
    if (total != null) total = round2(total / 100);
    if (taxAmt != null) taxAmt = round2(taxAmt / 100);
    notes.push("Decimal points were unclear — check rate and amount");
  }

  // MRP as printed, unless a lost decimal point makes it implausibly large next to the rate
  let mrp: number | null = null;
  if (mrpTok) {
    const vs = values(mrpTok);
    // Must look like a price for this rate; item codes and barcodes sit in the same place on some layouts
    mrp = rate != null ? (vs.filter((v) => v >= rate! * 0.9 && v <= rate! * 4).sort((a, b) => a - b)[0] ?? null) : mrpTok.text.includes(".") ? mrpTok.num : null;
    if (!mrp || mrp > 100_000) mrp = null;
  }

  const avgConf = toks.reduce((s, t) => s + t.conf, 0) / Math.max(1, toks.length);
  const confidence: ExtractedLine["confidence"] = solved && avgConf >= 75 ? "high" : solved || gross != null ? "medium" : "low";
  if (!solved && gross == null) notes.push("Could not read qty / rate / amount — enter them from the paper");

  return {
    solved,
    line: {
      line_no: lineNo,
      item_code: null,
      description,
      hsn,
      uom: unit,
      cases: null,
      pieces: null,
      units_per_case: null,
      qty: qty ?? 0,
      free_qty: null,
      mrp,
      rate,
      rate_incl_tax: null,
      gross,
      discount_pct: discPct || null,
      discount_amt: discAmt,
      scheme_amt: null,
      taxable,
      gst_pct: gst,
      tax_amt: taxAmt,
      total,
      batch: null,
      expiry: null,
      handwritten_note: notes.length ? notes.join(" · ") : null,
      confidence,
    },
  };
}

// ───────────────────────── Header fields ─────────────────────────
const GSTIN_RE = /\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]/;
const DATE_RE = /\b(\d{1,2})[-/.](\d{1,2}|[A-Za-z]{3})[-/.](\d{2,4})\b/;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function isoDate(m: RegExpMatchArray): string | null {
  const [, d, mo] = m;
  let y = m[3];
  const mi = /\d/.test(mo) ? Number(mo) : MONTHS.indexOf(mo.toLowerCase().replace("0", "o")) + 1;
  if (!mi || mi > 12) return null;
  if (y.length === 2) y = `20${y}`;
  const dd = Number(d);
  if (dd < 1 || dd > 31) return null;
  return `${y}-${String(mi).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function fixGstin(s: string): string | null {
  const c = s.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const toDigit: Record<string, string> = { O: "0", I: "1", L: "1", S: "5", B: "8", Z: "2", G: "6", T: "7" };
  const toLetter: Record<string, string> = { "0": "O", "1": "I", "5": "S", "8": "B", "2": "Z", "6": "G", "4": "A" };
  for (let i = 0; i + 15 <= c.length; i++) {
    // Position-aware OCR fixes: digits at 0-1 and 7-10, letters at 2-6 and 11
    const chars = c.slice(i, i + 15).split("");
    [0, 1, 7, 8, 9, 10].forEach((p) => (chars[p] = toDigit[chars[p]] ?? chars[p]));
    [2, 3, 4, 5, 6, 11].forEach((p) => (chars[p] = toLetter[chars[p]] ?? chars[p]));
    chars[13] = "Z";
    const fixed = chars.join("");
    if (GSTIN_RE.test(fixed)) return fixed;
  }
  return null;
}

function lastAmount(text: string): number | null {
  const ms = [...text.matchAll(/(\(-\)|-)?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|\d+)/g)];
  if (!ms.length) return null;
  const m = ms[ms.length - 1];
  const v = Number(m[2].replace(/,/g, ""));
  return m[1] ? -v : v;
}

export function parseOcrInvoice(lines: OcrLine[], storeGstin?: string | null): { invoice: ExtractedInvoice; score: number } {
  const sorted = [...lines].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const texts = sorted.map(lineText);
  const notes: string[] = ["Read with free OCR — check every figure against the paper invoice."];

  // GSTINs: the one that isn't the store's belongs to the supplier
  const storeKey = (storeGstin ?? "32ABBFR8496H1ZV").slice(2, 7);
  let supplierGstin: string | null = null;
  let buyerGstin: string | null = null;
  for (const t of texts) {
    for (const piece of t.split(/\s+|:/)) {
      if (piece.replace(/[^0-9A-Za-z]/g, "").length < 14) continue;
      const g = fixGstin(piece);
      if (!g) continue;
      if (g.slice(2, 7) === storeKey) buyerGstin ??= g;
      else supplierGstin ??= g;
    }
  }

  // Invoice number: same line after the label, or the token under the label on the next line
  let invoiceNo: string | null = null;
  for (let i = 0; i < sorted.length && !invoiceNo; i++) {
    const t = texts[i];
    const m = t.match(/\bInv(?:oice)?\.?\s*(?:No|Number|#)\.?\s*[:.]?\s*([A-Z0-9][A-Z0-9/-]{2,})/i);
    if (m && /\d/.test(m[1])) invoiceNo = m[1];
    else if (/\bInv(?:oice)?\.?\s*(?:No|Number)\b/i.test(t)) {
      const label = sorted[i].words.find((w) => /^inv/i.test(w.text));
      for (const next of sorted.slice(i + 1, i + 3)) {
        const cand = next.words.find(
          (w) => label && w.bbox.x1 > label.bbox.x0 - 40 && w.bbox.x0 < label.bbox.x1 + 200 && /\d/.test(w.text) && w.text.length >= 4,
        );
        if (cand) {
          invoiceNo = cand.text.replace(/[^A-Za-z0-9/-]/g, "");
          break;
        }
      }
    }
  }

  let invoiceDate: string | null = null;
  for (const t of texts) {
    if (/exp|dl no|fssai/i.test(t)) continue;
    const m = t.match(DATE_RE);
    if (m && /date|dated|dt/i.test(t) && (invoiceDate = isoDate(m))) break;
  }
  if (!invoiceDate)
    for (const t of texts) {
      if (/exp/i.test(t)) continue;
      const m = t.match(DATE_RE);
      if (m && (invoiceDate = isoDate(m))) break;
    }

  let poNo: string | null = null;
  for (const t of texts) {
    const m = t.match(/(?:buyer'?s order no|order no|p\.?o\.? no|reference no)[^0-9]{0,15}(\d{2,})/i);
    if (m) {
      poNo = m[1];
      break;
    }
  }

  let invoiceTotal: number | null = null;
  for (const re of [/grand total|invoice total|net payable|net amount payable/i, /^\s*total\b/i]) {
    for (const t of texts) if (re.test(t)) invoiceTotal = lastAmount(t.replace(/rs\.?/gi, " ")) ?? invoiceTotal;
    if (invoiceTotal != null) break;
  }
  let roundOff: number | null = null;
  for (const t of texts) if (/round\s*-?\s*of/i.test(t)) roundOff = lastAmount(t);
  if (roundOff != null && Math.abs(roundOff) >= 1) roundOff = null;

  // Supplier name: first sizeable text line near the top
  let supplierName: string | null = null;
  const pageBottom = sorted.at(-1)?.bbox.y1 ?? 1000;
  for (const l of sorted.filter((x) => x.bbox.y0 < pageBottom * 0.15)) {
    const words = l.words
      .map((w) => w.text)
      .filter((w) => /^[A-Za-z&.'-]{3,}$/.test(w) && !/^(tax|invoice|original|recipient|for|gstin|distributor)$/i.test(w));
    if (words.join("").length >= 6) {
      supplierName = words.slice(0, 4).join(" ");
      break;
    }
  }

  // Line items between the column header and the first summary row
  const headerIdx = texts.findIndex((t) => (t.match(HEADER_WORDS)?.length ?? 0) >= 3);
  const items: ParsedLine[] = [];
  for (let i = headerIdx + 1; i < sorted.length; i++) {
    const t = texts[i];
    const mrpLine = t.match(/MRP\s*\/?\s*(?:Marginal)?\s*[:.]?\s*(\d+(?:[.\s]\d{2})?)/i);
    if (mrpLine) {
      if (items.length) items[items.length - 1].line.mrp ??= Number(mrpLine[1].replace(/\s/, "."));
      continue;
    }
    if (SUMMARY.test(t)) {
      if (items.length) break;
      continue;
    }
    const toks = tokenize(sorted[i]);
    const parsed = parseItemLine(toks, items.length + 1);
    if (parsed && (parsed.line.gross != null || parsed.line.qty > 0 || toks.filter((x) => x.num != null).length >= 3)) items.push(parsed);
  }

  // A line whose decimals were all lost reads as 100× another line's rate (1732 vs 17.32)
  const rates = new Set(items.map((p) => p.line.rate).filter((r): r is number => r != null && r < 100));
  for (const { line: l } of items) {
    if (l.rate == null || l.rate < 100 || !rates.has(round2(l.rate / 100))) continue;
    l.rate = round2(l.rate / 100);
    for (const k of ["gross", "taxable", "tax_amt", "total"] as const) if (l[k] != null) l[k] = round2(l[k]! / 100);
    if (l.discount_amt != null && l.discount_amt >= 1) l.discount_amt = round2(l.discount_amt / 100);
    l.handwritten_note = [l.handwritten_note, "Decimal points were unclear — check rate and amount"].filter(Boolean).join(" · ");
  }

  const solved = items.filter((p) => p.solved).length;
  const sum = items.reduce((s, p) => s + (p.line.total ?? (p.line.taxable ?? 0) * (1 + (p.line.gst_pct ?? 0) / 100)), 0);
  const totalOk = invoiceTotal != null && Math.abs(sum + (roundOff ?? 0) - invoiceTotal) <= 2;
  if (!items.length) notes.push("No item lines could be read — enter them manually or retake a sharper, closer photo.");
  else if (solved < items.length) notes.push(`${items.length - solved} of ${items.length} lines need checking.`);

  const score = solved * 3 + items.length + (totalOk ? 6 : 0) + [supplierGstin, invoiceNo, invoiceDate, invoiceTotal].filter(Boolean).length;

  return {
    score,
    invoice: {
      supplier_name: supplierName,
      supplier_gstin: supplierGstin,
      buyer_name: null,
      buyer_gstin: buyerGstin,
      invoice_no: invoiceNo,
      invoice_date: invoiceDate,
      po_no: poNo,
      irn: null,
      internal_ref: null,
      lf_no: null,
      line_amounts_include_tax: items.some((p) => p.line.total != null),
      subtotal: null,
      tax_total: null,
      round_off: roundOff,
      invoice_total: invoiceTotal,
      lines: items.map((p) => p.line),
      notes,
    },
  };
}

/** Prefer the pass whose lines add up; fill missing header fields from the other. */
export function mergeOcrPasses(results: { invoice: ExtractedInvoice; score: number }[]): ExtractedInvoice {
  const [best, ...others] = [...results].sort((a, b) => b.score - a.score);
  const inv = { ...best.invoice };
  for (const o of others) {
    for (const k of ["supplier_name", "supplier_gstin", "buyer_gstin", "invoice_no", "invoice_date", "po_no", "invoice_total", "round_off"] as const) {
      if (inv[k] == null && o.invoice[k] != null) (inv as Record<string, unknown>)[k] = o.invoice[k];
    }
  }
  return inv;
}
