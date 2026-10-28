import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";

interface Props {
  onDetect: (code: string, format: string) => void;
  paused?: boolean;
  className?: string;
}

interface DetectedBarcode {
  rawValue: string;
  format: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: {
      new (opts?: { formats: string[] }): BarcodeDetectorLike;
      getSupportedFormats(): Promise<string[]>;
    };
  }
}

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code", "data_matrix"];

/**
 * Continuous camera scanner. Uses the native BarcodeDetector where available (Android Chrome),
 * otherwise ZXing. Identical packs share a barcode, so the same code is accepted again once it
 * has left the frame briefly, or after a short hold.
 */
export default function BarcodeScanner({ onDetect, paused, className }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;
  const last = useRef({ code: "", at: 0, seenAt: 0 });

  function handle(code: string, format: string) {
    const now = Date.now();
    const l = last.current;
    const gone = now - l.seenAt > 600; // code left the frame
    l.seenAt = now;
    if (pausedRef.current) return;
    if (code === l.code && !gone && now - l.at < 2500) return;
    if (code !== l.code && now - l.at < 700) return; // avoid double-reads across adjacent packs
    l.code = code;
    l.at = now;
    onDetectRef.current(code, format);
  }

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let controls: IScannerControls | null = null;
    let timer: number | undefined;
    const video = videoRef.current!;

    (async () => {
      try {
        const native = window.BarcodeDetector ? (await window.BarcodeDetector.getSupportedFormats()).length > 0 : false;
        if (native) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          });
          if (stopped) return stream.getTracks().forEach((t) => t.stop());
          video.srcObject = stream;
          await video.play();
          const track = stream.getVideoTracks()[0];
          const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
          setTorchSupported(Boolean(caps.torch));
          const supported = await window.BarcodeDetector!.getSupportedFormats();
          const detector = new window.BarcodeDetector!({ formats: FORMATS.filter((f) => supported.includes(f)) });
          const tick = async () => {
            if (stopped) return;
            try {
              if (video.readyState >= 2) {
                const codes = await detector.detect(video);
                if (codes[0]) handle(codes[0].rawValue, codes[0].format);
              }
            } catch {
              /* frame not ready */
            }
            timer = window.setTimeout(tick, 120);
          };
          void tick();
        } else {
          const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 120 });
          controls = await reader.decodeFromConstraints(
            { video: { facingMode: { ideal: "environment" } }, audio: false },
            video,
            (result) => {
              if (result) handle(result.getText(), String(result.getBarcodeFormat()));
            },
          );
          if (stopped) controls.stop();
        }
      } catch (e) {
        setError(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "Camera permission denied. Allow camera access in the browser settings."
            : "Camera not available. Use a Bluetooth scanner or type the barcode below.",
        );
      }
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      controls?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function toggleTorch() {
    const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch(next);
    } catch {
      setTorchSupported(false);
    }
  }

  return (
    <div className={`relative overflow-hidden rounded-xl bg-black ${className ?? ""}`}>
      <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
      <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80 shadow-[0_0_8px_red]" />
      {paused && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm font-medium text-white">Paused</div>
      )}
      {torchSupported && (
        <button
          type="button"
          onClick={toggleTorch}
          className="absolute right-2 top-2 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white"
        >
          {torch ? "Light off" : "Light on"}
        </button>
      )}
      {error && <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white">{error}</div>}
    </div>
  );
}
