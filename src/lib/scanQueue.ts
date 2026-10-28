// Offline-tolerant scan writes (FR-14, NFR Offline). Each scan gets a device-generated id,
// so a retried insert after a dropped connection never double counts.
import { supabase } from "./supabase";

export interface QueuedScan {
  id: string;
  invoice_id: string;
  line_id: string | null;
  barcode: string | null;
  qty: number;
  kind: "scan" | "manual";
  user_id: string;
  device_label: string;
  scanned_at: string;
}

const KEY = "rj.scanQueue";
const listeners = new Set<(n: number) => void>();

function load(): QueuedScan[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}
function save(q: QueuedScan[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    /* storage unavailable — scans still go direct when online */
  }
  listeners.forEach((fn) => fn(q.length));
}

export function pendingCount() {
  return load().length;
}

export function onQueueChange(fn: (n: number) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let flushing = false;
export async function flushQueue() {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    const q = load();
    if (!q.length) return;
    const { error } = await supabase.from("scans").upsert(q, { onConflict: "id", ignoreDuplicates: true });
    if (!error) {
      const sent = new Set(q.map((s) => s.id));
      save(load().filter((s) => !sent.has(s.id)));
    }
  } finally {
    flushing = false;
  }
}

/** Queue first, then try to send — the scan survives a page reload or a dropped network. */
export async function recordScan(scan: QueuedScan) {
  save([...load(), scan]);
  await flushQueue();
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flushQueue());
  setInterval(() => void flushQueue(), 5000);
}

export function deviceLabel(): string {
  try {
    let label = localStorage.getItem("rj.deviceLabel");
    if (!label) {
      const ua = navigator.userAgent;
      const kind = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone" : /Windows/i.test(ua) ? "PC" : "Device";
      label = `${kind}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      localStorage.setItem("rj.deviceLabel", label);
    }
    return label;
  } catch {
    return "Device";
  }
}
