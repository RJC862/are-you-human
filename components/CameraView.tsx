"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FaceLandmarker,
  HandLandmarker,
  DrawingUtils,
  NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { getFaceLandmarker, resetFaceLandmarker } from "@/lib/landmarks/faceLandmarker";
import { getHandLandmarker, resetHandLandmarker } from "@/lib/landmarks/handLandmarker";
import { parseFaceResult } from "@/lib/landmarks/parse";
import type { FaceFrame, RawLandmark } from "@/lib/landmarks/types";

export type CameraStatus =
  | "idle"
  | "loading"
  | "running"
  | "error"
  | "no-face";

export interface CameraViewProps {
  /** Called once per analyzed frame with the normalized face data. */
  onFrame?: (frame: FaceFrame) => void;
  /** Optional status change callback. */
  onStatus?: (status: CameraStatus) => void;
  /**
   * Optional video URL to analyze instead of the webcam (demo/adversarial mode).
   * When omitted, the live webcam is used.
   */
  videoSrc?: string;
  /** Mirror the video horizontally (natural for a webcam). Default true. */
  mirrored?: boolean;
  className?: string;
}

export default function CameraView({
  onFrame,
  onStatus,
  videoSrc,
  mirrored = true,
  className = "",
}: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const drawerRef = useRef<DrawingUtils | null>(null);
  const tessRef = useRef<Array<{ start: number; end: number }> | null>(null);
  const handConnRef = useRef<Array<{ start: number; end: number }> | null>(null);
  const lastVideoTimeRef = useRef<number>(-1);
  const fpsRef = useRef<{ last: number; frames: number }>({ last: 0, frames: 0 });

  const [status, setStatus] = useState<CameraStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [fps, setFps] = useState(0);

  const setBoth = useCallback(
    (s: CameraStatus) => {
      setStatus(s);
      onStatus?.(s);
    },
    [onStatus]
  );

  useEffect(() => {
    let cancelled = false;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    async function setupSource() {
      if (videoSrc) {
        video!.srcObject = null;
        video!.src = videoSrc;
        video!.loop = true;
        video!.muted = true;
        await video!.play().catch(() => {});
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      video!.srcObject = stream;
      await video!.play().catch(() => {});
    }

    async function loadLandmarker(): Promise<FaceLandmarker> {
      try {
        return await getFaceLandmarker();
      } catch {
        // GPU delegate can fail on some machines; reset and retry (CPU path).
        resetFaceLandmarker();
        return await getFaceLandmarker();
      }
    }

    async function loadHandLandmarker(): Promise<HandLandmarker | null> {
      try {
        return await getHandLandmarker();
      } catch {
        try {
          resetHandLandmarker();
          return await getHandLandmarker();
        } catch {
          // Hand detection is optional; the app still works without it
          // (hand_wave / touch_nose challenges just won't fire).
          return null;
        }
      }
    }

    async function init() {
      try {
        setBoth("loading");
        await setupSource();
        if (cancelled) return;

        const landmarker = await loadLandmarker();
        if (cancelled) return;
        landmarkerRef.current = landmarker;

        const { DrawingUtils, FaceLandmarker, HandLandmarker } = await import(
          "@mediapipe/tasks-vision"
        );
        const ctx = canvas!.getContext("2d")!;
        drawerRef.current = new DrawingUtils(ctx);
        tessRef.current = FaceLandmarker.FACE_LANDMARKS_TESSELATION;
        handConnRef.current = HandLandmarker.HAND_CONNECTIONS;

        // Load hands after face so the mesh shows ASAP; non-blocking.
        handLandmarkerRef.current = await loadHandLandmarker();
        if (cancelled) return;

        setBoth("running");
        renderLoop();
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Camera permission denied. Please allow camera access and reload."
            : err instanceof DOMException && err.name === "NotFoundError"
              ? "No camera found on this device."
              : `Could not start camera: ${(err as Error).message}`;
        setErrorMsg(msg);
        setBoth("error");
      }
    }

    function renderLoop() {
      if (cancelled) return;
      const landmarker = landmarkerRef.current;
      const drawer = drawerRef.current;
      if (!video || !canvas || !landmarker || !drawer) {
        rafRef.current = requestAnimationFrame(renderLoop);
        return;
      }

      if (video.readyState >= 2 && video.videoWidth > 0) {
        if (canvas.width !== video.videoWidth) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }

        // Only run detection on new frames.
        if (video.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = video.currentTime;
          const now = performance.now();
          const result = landmarker.detectForVideo(video, now);
          const frame = parseFaceResult(result as unknown as Parameters<typeof parseFaceResult>[0], now);

          // Run hand detection (independent of face) and attach to the frame.
          let handResult: { landmarks?: NormalizedLandmark[][] } | null = null;
          const handLm = handLandmarkerRef.current;
          if (handLm) {
            handResult = handLm.detectForVideo(video, now) as {
              landmarks?: NormalizedLandmark[][];
            };
            frame.hands = (handResult.landmarks ?? []).map((h) =>
              h.map((p) => ({ x: p.x, y: p.y, z: p.z })) as RawLandmark[]
            );
          }

          drawFrame(drawer, canvas, result, handResult);
          onFrame?.(frame);

          if (!frame.hasFace && status !== "no-face") setBoth("no-face");
          else if (frame.hasFace && status === "no-face") setBoth("running");

          // FPS counter.
          const f = fpsRef.current;
          f.frames++;
          if (now - f.last >= 500) {
            setFps(Math.round((f.frames * 1000) / (now - f.last)));
            f.last = now;
            f.frames = 0;
          }
        }
      }
      rafRef.current = requestAnimationFrame(renderLoop);
    }

    init();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoSrc]);

  function drawFrame(
    drawer: DrawingUtils,
    canvas: HTMLCanvasElement,
    result: unknown,
    handResult?: { landmarks?: NormalizedLandmark[][] } | null
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const r = result as { faceLandmarks?: NormalizedLandmark[][] };
    const faces = r.faceLandmarks ?? [];
    const tess = tessRef.current;
    for (const landmarks of faces) {
      if (tess) {
        drawer.drawConnectors(landmarks, tess, {
          color: "#6366f166",
          lineWidth: 0.5,
        });
      }
    }

    const hands = handResult?.landmarks ?? [];
    const conn = handConnRef.current;
    for (const hand of hands) {
      if (conn) {
        drawer.drawConnectors(hand, conn, { color: "#22c55eaa", lineWidth: 2 });
      }
      drawer.drawLandmarks(hand, { color: "#22c55e", radius: 2 });
    }
    ctx.restore();
  }

  return (
    <div className={`relative overflow-hidden rounded-xl bg-black ${className}`}>
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        style={{ transform: mirrored ? "scaleX(-1)" : undefined }}
        playsInline
        muted
      />
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        style={{ transform: mirrored ? "scaleX(-1)" : undefined }}
      />

      {/* HUD */}
      <div className="pointer-events-none absolute left-3 top-3 flex gap-2 font-mono text-xs">
        <span className="rounded bg-black/60 px-2 py-1 text-gray-300">
          {fps} fps
        </span>
        <StatusBadge status={status} />
      </div>

      {(status === "loading" || status === "idle") && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70">
          <p className="animate-pulse font-mono text-sm text-gray-300">
            Loading face &amp; hand engine…
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6 text-center">
          <p className="max-w-sm text-sm text-danger">{errorMsg}</p>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: CameraStatus }) {
  const map: Record<CameraStatus, { label: string; cls: string }> = {
    idle: { label: "idle", cls: "text-gray-400" },
    loading: { label: "loading", cls: "text-warn" },
    running: { label: "tracking", cls: "text-success" },
    "no-face": { label: "no face", cls: "text-warn" },
    error: { label: "error", cls: "text-danger" },
  };
  const { label, cls } = map[status];
  return <span className={`rounded bg-black/60 px-2 py-1 ${cls}`}>{label}</span>;
}
