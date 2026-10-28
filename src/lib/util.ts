// Small browser helpers: image compression, beeps, e-invoice QR decoding, formatting.

export interface PreparedImage {
  data: string; // base64 without prefix
  media_type: "image/jpeg";
  blob: Blob;
  preview: string;
}

/** Resize to keep the request under Vercel's 4.5 MB body limit while staying legible. */
export async function prepareImage(file: File, maxEdge = 2200, quality = 0.85): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("Could not encode image"))), "image/jpeg", quality),
  );
  const dataUrl: string = await new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.readAsDataURL(blob);
  });
  return { data: dataUrl.split(",")[1], media_type: "image/jpeg", blob, preview: dataUrl };
}

let audioCtx: AudioContext | null = null;
export function beep(kind: "ok" | "warn" | "error" = "ok") {
  try {
    audioCtx ??= new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = kind === "ok" ? 1200 : kind === "warn" ? 600 : 300;
    osc.type = kind === "ok" ? "sine" : "square";
    gain.gain.value = 0.15;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + (kind === "ok" ? 0.08 : 0.3));
  } catch {
    /* audio blocked */
  }
  navigator.vibrate?.(kind === "ok" ? 40 : [120, 60, 120]);
}

export interface EInvoiceQr {
  SellerGstin?: string;
  BuyerGstin?: string;
  DocNo?: string;
  DocTyp?: string;
  DocDt?: string;
  TotInvVal?: number;
  ItemCnt?: number;
  MainHsnCode?: string;
  Irn?: string;
  IrnDt?: string;
}

/** The GST e-invoice QR is a signed JWT whose payload has a JSON "data" string. */
export function decodeEInvoiceQr(text: string): EInvoiceQr | null {
  const parts = text.trim().split(".");
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json);
    return typeof payload.data === "string" ? JSON.parse(payload.data) : payload.data ?? null;
  } catch {
    return null;
  }
}

/** dd/mm/yyyy → yyyy-mm-dd */
export function dmyToIso(s: string | undefined | null): string | null {
  const m = s?.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

export const inr = (n: number | null | undefined, digits = 2) =>
  n == null ? "—" : "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const num = (n: number | null | undefined, digits = 2) =>
  n == null ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: digits });

export function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // randomUUID needs a secure context; fall back for http:// on a LAN.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
