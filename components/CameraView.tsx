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
import { isVirtualCameraLabel } from "@/lib/liveness/actions";

export type CameraStatus =
  | "idle"
  | "loading"
  | "running"
  | "error"
  | "no-face";

/** Information about the active camera source, used for the virtual-camera risk check. */
export interface CameraInfo {
  /** Label of the active video track (e.g. "FaceTime HD Camera", "OBS Virtual Camera"). */
  label: string;
  /** Labels of all video input devices reported by enumerateDevices (informational / debug only). */
  deviceLabels: string[];
  /** True if the ACTIVE track label matches a virtual-camera keyword (device list is not considered). */
  isVirtual: boolean;
}

export interface CameraViewProps {
  /** Called once per analyzed frame with the normalized face data. */
  onFrame?: (frame: FaceFrame) => void;
  /** Optional status change callback. */
  onStatus?: (status: CameraStatus) => void;
  /** Called when the active camera source is identified or changes. */
  onCameraInfo?: (info: CameraInfo) => void;
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
  onCameraInfo,
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
  const [cameraInfo, setCameraInfo] = useState<CameraInfo | null>(null);

  // Keep the latest onCameraInfo callback in a ref so the inspection logic can
  // run from the setup effect / devicechange listener without re-subscribing.
  const onCameraInfoRef = useRef(onCameraInfo);
  useEffect(() => {
    onCameraInfoRef.current = onCameraInfo;
  }, [onCameraInfo]);

  const setBoth = useCallback(
    (s: CameraStatus) => {
      setStatus(s);
      onStatus?.(s);
    },
    [onStatus]
  );

  // Inspect the active video source for virtual-camera keywords. Soft risk
  // signal only — never affects the pass/fail verdict.
  //
  // The warning is driven SOLELY by the label of the track actually feeding the
  // video (the one this stream is bound to). enumerateDevices is read only to
  // show the full device list in the debug panel — it must NOT drive the
  // warning, because a virtual camera merely being *installed* (present in the
  // device list) does not mean it is the active source.
  const inspectCamera = useCallback(async (stream: MediaStream | null) => {
    const track = stream?.getVideoTracks()[0];
    // Prefer the track's settings.deviceId to resolve the current label, so a
    // relabeled/renamed track still reports accurately.
    const label = track?.label ?? "";

    let deviceLabels: string[] = [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      deviceLabels = devices
        .filter((d) => d.kind === "videoinput")
        .map((d) => d.label)
        .filter((l) => l.length > 0);
    } catch {
      // enumerateDevices can reject (e.g. permissions); the active-track label
      // is what matters for the warning, so this is non-fatal.
    }

    // Decision is based on the ACTIVE track only.
    const isVirtual = isVirtualCameraLabel(label);
    const info: CameraInfo = { label, deviceLabels, isVirtual };
    setCameraInfo(info);
    onCameraInfoRef.current?.(info);
  }, []);

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
      // Labels are only populated after permission is granted, so inspect now.
      void inspectCamera(stream);
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
          // (the touch-nose challenge just won't fire).
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

    // Re-acquire the stream when the set of media devices changes (camera
    // added/removed/switched, e.g. a virtual camera started or stopped
    // mid-session). A live MediaStreamTrack keeps its original label for its
    // whole lifetime, so simply re-reading the current stream would report a
    // stale source — we must get a fresh stream so getUserMedia binds to the
    // now-default device, then re-inspect that.
    let reacquiring = false;
    async function onDeviceChange() {
      if (cancelled || videoSrc || reacquiring) return;
      reacquiring = true;
      try {
        const fresh = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          fresh.getTracks().forEach((t) => t.stop());
          return;
        }
        // Swap in the new stream and stop the old tracks.
        const old = streamRef.current;
        streamRef.current = fresh;
        if (video) {
          video.srcObject = fresh;
          await video.play().catch(() => {});
        }
        old?.getTracks().forEach((t) => t.stop());
        await inspectCamera(fresh);
      } catch {
        // If re-acquire fails, keep the existing stream and re-inspect it so the
        // UI still reflects the last known source.
        await inspectCamera(streamRef.current);
      } finally {
        reacquiring = false;
      }
    }
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);

    init();

    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.(
        "devicechange",
        onDeviceChange
      );
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

      {/* Virtual-camera warning banner (risk signal; does not affect pass/fail). */}
      {cameraInfo?.isVirtual && (
        <div
          role="alert"
          className="absolute inset-x-0 top-0 z-10 border-b border-warn/50 bg-warn/90 px-4 py-2 text-center text-sm font-semibold text-black"
        >
          ⚠ Virtual camera detected — this video may not come from a real camera.
        </div>
      )}

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
