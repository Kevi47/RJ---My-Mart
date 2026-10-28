import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { createClient } from "@supabase/supabase-js";
import { ExtractedInvoice } from "./_lib/extractSchema.js";

const SYSTEM = `You read photographed Indian GST supplier invoices for a supermarket (RJ My Mart) and transcribe them into structured data for stock receiving.

Layouts differ by supplier. Do not assume a template:
- MRP may be its own column, a sub-line under the description (e.g. "MRP / Marginal: 75.00/NOS"), or absent (then null).
- Item codes may be missing (then null).
- Quantity may be split into cases + pieces with units-per-case (e.g. "Cs 0, Pcs 4/48" means 0 cases, 4 pieces, 48 per case → qty 4). Always give qty as total single pieces.
- Discounts may be a % column, a rupee Disc column, and/or a scheme (SCH) amount. Keep them separate.
- "rate" is per piece before discount and excluding GST. If the invoice prints both an inclusive and an exclusive rate, put the exclusive one in rate and the inclusive one in rate_incl_tax.
- GST may be printed as CGST% + SGST% (add them for gst_pct) or IGST%.
- Some invoices print line amounts without tax and add CGST/SGST rows at the bottom; set line_amounts_include_tax accordingly.

Handwriting: staff write a circled number (internal inward number), an "LF-<n>" number, and tick marks. Capture the circled number as internal_ref and the LF number as lf_no. Ignore ticks. If a handwritten correction changes a printed figure, transcribe the printed figure and describe the correction in handwritten_note.

Transcribe numbers exactly as printed; never compute a value to replace an illegible one — use null and add a note instead. Mark confidence low on any line with a digit you are unsure of. Skip summary rows (Total, Group Total, scheme summaries, tax summaries) — only real product lines go in lines.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Only signed-in staff can spend API credits.
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: "Supabase env vars missing on server" });
  const { data: userData, error: authError } = await createClient(supabaseUrl, supabaseKey).auth.getUser(token);
  if (authError || !userData.user) return res.status(401).json({ error: "Not signed in" });

  const images: { data: string; media_type: string }[] = req.body?.images ?? [];
  if (!Array.isArray(images) || images.length === 0 || images.length > 6) {
    return res.status(400).json({ error: "Send 1–6 invoice images" });
  }

  const client = new Anthropic({ timeout: 280_000 });
  try {
    const response = await client.beta.messages.parse({
      model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(ExtractedInvoice) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            ...images.map((img) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: img.media_type as "image/jpeg" | "image/png" | "image/webp",
                data: img.data,
              },
            })),
            {
              type: "text" as const,
              text:
                images.length > 1
                  ? `These ${images.length} images are pages of one invoice, in order. Extract the whole invoice.`
                  : "Extract this invoice.",
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return res.status(422).json({ error: "The model declined to read this image. Try a clearer photo." });
    }
    if (response.stop_reason === "max_tokens" || !response.parsed_output) {
      return res.status(422).json({ error: "Could not read the full invoice. Try splitting it into pages." });
    }
    return res.status(200).json({ invoice: response.parsed_output, model: response.model, usage: response.usage });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "Busy — try again in a minute" });
    if (err instanceof Anthropic.AuthenticationError) return res.status(500).json({ error: "ANTHROPIC_API_KEY is invalid" });
    if (err instanceof Anthropic.APIError) return res.status(502).json({ error: `Claude API error ${err.status}: ${err.message}` });
    console.error(err);
    return res.status(500).json({ error: "Extraction failed" });
  }
}
