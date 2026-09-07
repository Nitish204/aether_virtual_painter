import { useCallback, useEffect, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { apiFetch } from "../utils/api";

const FRAME_W = 640;
const FRAME_H = 480;
const MAX_HISTORY = 25;
const RAISE_THRESHOLD = 0.06; // normalized (0-1) landmark units, ~ the 40px threshold at 640x480

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

// Same check as the fixed Python `finger_raised()`: a fingertip counts as
// "raised" only if it's meaningfully above its own knuckle, not just
// technically higher by a pixel.
function fingerRaised(tipY, baseY) {
  return baseY - tipY > RAISE_THRESHOLD;
}

/**
 * Owns the camera, the HandLandmarker model, the persistent drawing
 * layer, and undo/redo history. Everything runs client-side in the
 * browser — there is no Python/Streamlit backend in this version at all.
 *
 * Gesture rule (matches the fixed Python app, verified there with a unit
 * test): raise only your index finger to draw; raise index + middle to
 * move without drawing.
 */
export function useHandPainter() {
  const videoRef = useRef(null);
  const outputCanvasRef = useRef(null);
  const maskCanvasRef = useRef(null); // offscreen, holds the actual painting (with real alpha transparency)

  const [status, setStatus] = useState("loading"); // loading | ready | tracking | idle | error
  const [errorMessage, setErrorMessage] = useState("");
  const [fps, setFps] = useState(0);

  const toolRef = useRef("draw");
  const colorRef = useRef("#FF3C3C");
  const thicknessRef = useRef(5);

  const [tool, setTool] = useState("draw");
  const [color, setColor] = useState("#FF3C3C");
  const [thickness, setThickness] = useState(5);

  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { thicknessRef.current = thickness; }, [thickness]);

  // drawing state, owned entirely by the rAF loop (mirrors the Python
  // media-thread-only state — no cross-thread concerns here since JS is
  // single-threaded, but the same reset-on-hand-lost logic applies)
  const drawState = useRef({ prevX: 0, prevY: 0, shapeAnchor: null });
  const historyRef = useRef({ stack: [], pos: -1 });
  const [historyTick, setHistoryTick] = useState(0); // bump to force undo/redo button enabled-state re-render

  const pushHistory = useCallback(() => {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    const ctx = mask.getContext("2d");
    const snapshot = ctx.getImageData(0, 0, FRAME_W, FRAME_H);
    const h = historyRef.current;
    h.stack = h.stack.slice(0, h.pos + 1);
    h.stack.push(snapshot);
    if (h.stack.length > MAX_HISTORY) h.stack.shift();
    h.pos = h.stack.length - 1;
    setHistoryTick((t) => t + 1);
  }, []);

  const restoreSnapshot = useCallback((snapshot) => {
    const mask = maskCanvasRef.current;
    if (!mask || !snapshot) return;
    mask.getContext("2d").putImageData(snapshot, 0, 0);
  }, []);

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.pos > 0) {
      h.pos -= 1;
      restoreSnapshot(h.stack[h.pos]);
      setHistoryTick((t) => t + 1);
    }
  }, [restoreSnapshot]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.pos < h.stack.length - 1) {
      h.pos += 1;
      restoreSnapshot(h.stack[h.pos]);
      setHistoryTick((t) => t + 1);
    }
  }, [restoreSnapshot]);

  const clear = useCallback(() => {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    mask.getContext("2d").clearRect(0, 0, FRAME_W, FRAME_H);
    pushHistory();
  }, [pushHistory]);

  const downloadPainting = useCallback(() => {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    mask.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `aether_painting_${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }, []);

  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const saveToCloud = useCallback(() => {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    setSaveState("saving");
    mask.toBlob(async (blob) => {
      if (!blob) { setSaveState("error"); return; }
      try {
        const buf = await blob.arrayBuffer();
        // btoa needs a binary string, not raw bytes — chunk the
        // conversion so it doesn't choke on a large canvas.
        let binary = "";
        const bytes = new Uint8Array(buf);
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        const base64 = btoa(binary);

        const res = await apiFetch("/api/drawings", {
          method: "POST",
          body: JSON.stringify({
            image_base64: base64,
            tool: toolRef.current,
            color: colorRef.current,
            thickness: thicknessRef.current,
          }),
        });
        if (!res.ok) throw new Error();
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 2500);
      } catch {
        setSaveState("error");
        setTimeout(() => setSaveState("idle"), 3000);
      }
    }, "image/png");
  }, []);

  useEffect(() => {
    let cancelled = false;
    let stream = null;
    let landmarker = null;
    let rafId = null;
    let lastFrameTimes = [];

    const mask = maskCanvasRef.current;
    mask.width = FRAME_W;
    mask.height = FRAME_H;

    async function setup() {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
        landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.6,
          minTrackingConfidence: 0.6,
        });

        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: FRAME_W, height: FRAME_H },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();

        pushHistory(); // seed history with the blank canvas
        setStatus("ready");
        loop();
      } catch (err) {
        console.error("[AETHER] setup failed:", err);
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(
          err.name === "NotAllowedError"
            ? "Camera access was denied. Allow camera access and reload the page."
            : "Couldn't start the camera or hand-tracking model. Check your connection and reload."
        );
      }
    }

    function loop() {
      if (cancelled) return;
      const video = videoRef.current;
      const output = outputCanvasRef.current;
      const mask = maskCanvasRef.current;
      if (!video || !output || !mask || video.readyState < 2) {
        rafId = requestAnimationFrame(loop);
        return;
      }

      const t0 = performance.now();
      const outCtx = output.getContext("2d");
      const maskCtx = mask.getContext("2d");

      // Mirror the feed so movement feels natural (matches cv2.flip(img, 1)).
      outCtx.save();
      outCtx.translate(FRAME_W, 0);
      outCtx.scale(-1, 1);
      outCtx.drawImage(video, 0, 0, FRAME_W, FRAME_H);
      outCtx.restore();

      const nowMs = performance.now();
      const result = landmarker.detectForVideo(video, nowMs);

      if (result.landmarks && result.landmarks.length > 0) {
        setStatus("tracking");
        const hand = result.landmarks[0];

        // draw skeleton (mirrored to match the flipped video)
        outCtx.strokeStyle = "#5EEAD4";
        outCtx.lineWidth = 1;
        for (const [a, b] of HAND_CONNECTIONS) {
          outCtx.beginPath();
          outCtx.moveTo(FRAME_W - hand[a].x * FRAME_W, hand[a].y * FRAME_H);
          outCtx.lineTo(FRAME_W - hand[b].x * FRAME_W, hand[b].y * FRAME_H);
          outCtx.stroke();
        }
        outCtx.fillStyle = "#A78BFA";
        for (const lm of hand) {
          outCtx.beginPath();
          outCtx.arc(FRAME_W - lm.x * FRAME_W, lm.y * FRAME_H, 2, 0, Math.PI * 2);
          outCtx.fill();
        }

        const x = FRAME_W - hand[8].x * FRAME_W;
        const y = hand[8].y * FRAME_H;
        const y5 = hand[5].y;
        const xi = FRAME_W - hand[12].x * FRAME_W;
        const yi = hand[12].y;
        const y9 = hand[9].y;

        const indexUp = fingerRaised(hand[8].y, y5);
        const middleUp = fingerRaised(yi, y9);
        const active = indexUp && !middleUp;

        const tool = toolRef.current;
        const color = colorRef.current;
        const thickness = thicknessRef.current;
        const ds = drawState.current;

        if (tool === "draw") {
          if (active) {
            if (ds.prevX === 0 && ds.prevY === 0) { ds.prevX = x; ds.prevY = y; }
            maskCtx.globalCompositeOperation = "source-over";
            maskCtx.strokeStyle = color;
            maskCtx.lineWidth = thickness;
            maskCtx.lineCap = "round";
            maskCtx.beginPath();
            maskCtx.moveTo(ds.prevX, ds.prevY);
            maskCtx.lineTo(x, y);
            maskCtx.stroke();
            ds.prevX = x; ds.prevY = y;
          } else {
            if (ds.prevX || ds.prevY) pushHistory();
            ds.prevX = 0; ds.prevY = 0;
          }
        } else if (tool === "erase") {
          // Genuine improvement over the Python version's approach: rather
          // than painting a white circle (which only worked because that
          // canvas's "blank" was opaque white), destination-out actually
          // punches a transparent hole in the painting, which is the
          // correct way to erase on a canvas with real alpha support.
          const eraseRadius = Math.max(12, thickness * 6);
          if (active) {
            maskCtx.globalCompositeOperation = "destination-out";
            maskCtx.beginPath();
            maskCtx.arc(x, y, eraseRadius, 0, Math.PI * 2);
            maskCtx.fill();
            maskCtx.globalCompositeOperation = "source-over";
          } else {
            pushHistory();
          }
        } else if (tool === "line" || tool === "rectangle" || tool === "circle") {
          if (active) {
            if (!ds.shapeAnchor) ds.shapeAnchor = { x, y };
            outCtx.strokeStyle = color;
            outCtx.lineWidth = thickness;
            drawShapePreview(outCtx, tool, ds.shapeAnchor, { x, y });
          } else {
            if (ds.shapeAnchor) {
              maskCtx.globalCompositeOperation = "source-over";
              maskCtx.strokeStyle = color;
              maskCtx.lineWidth = thickness;
              drawShapePreview(maskCtx, tool, ds.shapeAnchor, { x, y });
              pushHistory();
            }
            ds.shapeAnchor = null;
          }
        }
      } else {
        // Same fix as the Python version: losing hand tracking mid-stroke
        // must not leave stale coordinates around, or the next detected
        // frame draws a stray line from the old position to the new one.
        setStatus("ready");
        const tool = toolRef.current;
        const ds = drawState.current;
        if (tool === "draw" && (ds.prevX || ds.prevY)) pushHistory();
        ds.prevX = 0; ds.prevY = 0;
        ds.shapeAnchor = null;
      }

      // composite the persistent painting on top of the live camera feed —
      // this is just a normal drawImage since the mask canvas has real
      // alpha transparency, no chroma-key trick needed.
      outCtx.drawImage(mask, 0, 0);

      const dt = performance.now() - t0;
      lastFrameTimes.push(dt);
      if (lastFrameTimes.length > 30) lastFrameTimes.shift();
      const avg = lastFrameTimes.reduce((a, b) => a + b, 0) / lastFrameTimes.length;
      setFps(Math.round(1000 / Math.max(avg, 1)));

      rafId = requestAnimationFrame(loop);
    }

    setup();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (landmarker) landmarker.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canUndo = historyRef.current.pos > 0;
  const canRedo = historyRef.current.pos < historyRef.current.stack.length - 1;

  return {
    videoRef, outputCanvasRef, maskCanvasRef,
    status, errorMessage, fps,
    tool, setTool, color, setColor, thickness, setThickness,
    undo, redo, clear, downloadPainting, saveToCloud, saveState,
    canUndo, canRedo, historyTick,
  };
}

function drawShapePreview(ctx, tool, anchor, current) {
  ctx.beginPath();
  if (tool === "line") {
    ctx.moveTo(anchor.x, anchor.y);
    ctx.lineTo(current.x, current.y);
  } else if (tool === "rectangle") {
    ctx.rect(anchor.x, anchor.y, current.x - anchor.x, current.y - anchor.y);
  } else if (tool === "circle") {
    const r = Math.hypot(current.x - anchor.x, current.y - anchor.y);
    ctx.arc(anchor.x, anchor.y, r, 0, Math.PI * 2);
  }
  ctx.stroke();
}
