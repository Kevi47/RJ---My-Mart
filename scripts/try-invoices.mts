// Offline trial: read invoice photos with the same prompt/schema as /api/extract, run the
// arithmetic checks, and match lines against a Polosys stock export. No Supabase needed.
//   node --env-file=.env.local scripts/try-invoices.mts <stock.xlsx> <invoice.jpg> [more.jpg...]
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ExtractedInvoice } from "../api/_lib/extractSchema.ts";
import { SYSTEM } from "../api/_lib/extractPrompt.ts";
import { parseSohFile, type SohRow } from "../src/lib/soh.ts";
import { effectiveCost, landedCost, validateHeader, validateLine } from "../src/lib/validate.ts";

const [stockPath, ...images] = process.argv.slice(2);
if (!stockPath || !images.length) {
  console.error("usage: node --env-file=.env.local scripts/try-invoices.mts <stock.xlsx> <invoice.jpg>...");
  process.exit(1);
}

const soh = await parseSohFile(new File([readFileSync(stockPath)], basename(stockPath)));
console.log(`Stock master: ${soh.rows.length} items (as on ${soh.asOnDate})\n`);

// Trigram similarity, close to what pg_trgm does in the database
const grams = (s: string) => {
  const t = `  ${s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()} `;
  const g = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3));
  return g;
};
const index = soh.rows.map((r) => ({ r, g: grams(r.name) }));
function bestMatch(desc: string): { row: SohRow; score: number } | null {
  const q = grams(desc);
  let best: { row: SohRow; score: number } | null = null;
  for (const { r, g } of index) {
    let common = 0;
    for (const x of q) if (g.has(x)) common++;
    const score = common / (q.size + g.size - common);
    if (!best || score > best.score) best = { row: r, score };
  }
  return best;
}

const rates = new Map([["34025000", 18], ["96190010", 0], ["96190030", 5], ["15131900", 5]]);
const client = new Anthropic({ timeout: 280_000 });
const f2 = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2));

for (const path of images) {
  const t0 = Date.now();
  const res = await client.messages.parse({
    model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
    max_tokens: 16000,
    output_config: { effort: "medium", format: zodOutputFormat(ExtractedInvoice) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: readFileSync(path).toString("base64") } },
          { type: "text", text: "Extract this invoice." },
        ],
      },
    ],
  });
  const inv = res.parsed_output;
  console.log("=".repeat(100));
  console.log(`${basename(path)}  (${((Date.now() - t0) / 1000).toFixed(0)}s, ${res.usage.input_tokens} in / ${res.usage.output_tokens} out)`);
  if (!inv) {
    console.log("  could not parse:", res.stop_reason);
    continue;
  }
  console.log(`${inv.supplier_name} | GSTIN ${inv.supplier_gstin} | Inv ${inv.invoice_no} | ${inv.invoice_date} | ref ${inv.internal_ref} | LF ${inv.lf_no} | total ${f2(inv.invoice_total)}`);
  const lines = inv.lines.map((l) => ({
    ...l,
    taxable: l.taxable ?? (!inv.line_amounts_include_tax && l.total != null && l.tax_amt == null ? l.total : null),
    total: inv.line_amounts_include_tax || l.tax_amt != null ? l.total : null,
    free_qty: l.free_qty ?? 0,
  }));
  for (const l of lines) {
    const m = bestMatch(l.description);
    const matched = m && m.score >= 0.3 ? m : null;
    const warn = validateLine(l, rates);
    const landed = landedCost(l);
    const margin = matched?.row.srate && landed ? ((matched.row.srate - landed) / matched.row.srate) * 100 : null;
    console.log(
      `  ${String(l.line_no).padStart(2)}. ${l.description.padEnd(34).slice(0, 34)} qty ${String(l.qty).padStart(4)}  MRP ${f2(l.mrp).padStart(7)}  rate ${f2(l.rate).padStart(7)}  net ${f2(effectiveCost(l)).padStart(7)}  GST ${l.gst_pct ?? "—"}%  [${l.confidence}]`,
    );
    console.log(
      `      → ${matched ? `${matched.row.pcode} ${matched.row.name} (score ${matched.score.toFixed(2)}) SRate ${matched.row.srate} PRate ${matched.row.prate}${margin != null ? ` margin ${margin.toFixed(1)}%` : ""}` : "no confident stock match (clerk picks once)"}`,
    );
    for (const w of warn) console.log(`      ⚠ ${w}`);
    if (l.handwritten_note) console.log(`      📝 ${l.handwritten_note}`);
  }
  const hv = validateHeader(lines, { invoice_total: inv.invoice_total, round_off: inv.round_off });
  console.log(`  Total check: lines ${f2(hv.lines_sum)} + round-off ${f2(inv.round_off)} vs invoice ${f2(hv.expected_total)} → ${hv.ok ? "OK" : "MISMATCH"}`);
  for (const n of [...hv.messages, ...inv.notes]) console.log(`  • ${n}`);
}
