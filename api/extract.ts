import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { createClient } from "@supabase/supabase-js";
import { ExtractedInvoice } from "./_lib/extractSchema.js";
import { SYSTEM } from "./_lib/extractPrompt.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(501).json({ error: "Reading invoices from photos is not set up yet. Use \"Enter manually instead\"." });
  }

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
