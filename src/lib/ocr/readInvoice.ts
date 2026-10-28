// Free in-browser invoice reading with Tesseract.js. Two passes per page — the photo as-is
// (automatic layout) and an enlarged, high-contrast copy read as one block — then the pass
// whose lines add up best wins. The OCR engine and English data (~10 MB) download once and
// are cached by the browser.
import type { ExtractedInvoice } from "../../../api/_lib/extractSchema";
import { mergeOcrPasses, parseOcrInvoice, type OcrLine } from "./parseInvoice";

export type OcrProgress = (label: string, fraction: number) => void;

async function loadCanvas(src: Blob, scale: number) {
  const bitmap = await createImageBitmap(src);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { canvas, ctx };
}

/** Enlarge ~2× → grayscale → stretch contrast (1st–99th percentile). Sharpening made results worse in tests. */
async function enhance(src: Blob): Promise<HTMLCanvasElement> {
  const probe = await createImageBitmap(src);
  const longEdge = Math.max(probe.width, probe.height);
  probe.close();
  const { canvas, ctx } = await loadCanvas(src, Math.max(1, Math.min(2, 3600 / longEdge)));
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = img.data;
  const n = canvas.width * canvas.height;
  const gray = new Float32Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    gray[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;
    hist[gray[i] | 0]++;
  }
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < n * 0.01; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]) < n * 0.01; hi--);
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < n; i++) px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = ((gray[i] - lo) * 255) / span;
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export async function readInvoiceOcr(pages: Blob[], storeGstin: string | null, onProgress: OcrProgress): Promise<ExtractedInvoice> {
  onProgress("Loading the reader (first time only, ~10 MB)…", 0);
  const { createWorker } = await import("tesseract.js");
  let current = { label: "", base: 0, share: 1 };
  const worker = await createWorker("eng", 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress(current.label, current.base + m.progress * current.share);
    },
  });
  try {
    await worker.setParameters({ preserve_interword_spaces: "1", user_defined_dpi: "300" } as Record<string, string>);
    // Which pass reads best depends on the photo, so try three and keep the one whose numbers add up
    const enhanced = new Map<Blob, HTMLCanvasElement>();
    const enhancedOf = async (b: Blob) => enhanced.get(b) ?? enhanced.set(b, await enhance(b)).get(b)!;
    const passes: { psm: string; prep: (b: Blob) => Promise<Blob | HTMLCanvasElement> }[] = [
      { psm: "3", prep: async (b) => b },
      { psm: "6", prep: enhancedOf },
      { psm: "3", prep: enhancedOf },
    ];
    const steps = passes.length * pages.length;
    const results = [];
    for (const [pi, pass] of passes.entries()) {
      await worker.setParameters({ tessedit_pageseg_mode: pass.psm } as Record<string, string>);
      const lines: OcrLine[] = [];
      for (const [n, page] of pages.entries()) {
        const step = pi * pages.length + n;
        current = { label: `Reading page ${n + 1} of ${pages.length} (pass ${pi + 1} of ${passes.length})…`, base: step / steps, share: 1 / steps };
        onProgress(current.label, current.base);
        const { data } = await worker.recognize(await pass.prep(page), {}, { blocks: true });
        // Offset later pages downwards so lines stay in reading order
        const dy = n * 100_000;
        for (const b of data.blocks ?? [])
          for (const p of b.paragraphs)
            for (const l of p.lines)
              lines.push({
                bbox: { ...l.bbox, y0: l.bbox.y0 + dy, y1: l.bbox.y1 + dy },
                words: l.words.map((w) => ({ text: w.text, conf: Math.round(w.confidence), bbox: { ...w.bbox, y0: w.bbox.y0 + dy, y1: w.bbox.y1 + dy } })),
              });
      }
      results.push(parseOcrInvoice(lines, storeGstin));
    }
    onProgress("Checking the figures…", 1);
    return mergeOcrPasses(results);
  } finally {
    await worker.terminate();
  }
}
