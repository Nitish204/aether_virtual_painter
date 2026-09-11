import { useCallback, useEffect, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { apiFetch } from "../utils/api";

// Used only as the initial canvas size before the camera actually
// starts (there's a brief moment before we know the real negotiated
// resolution). The real dimensions come from the video track itself
// once it's live — see DEFAULT_DIMS usage below.
const DEFAULT_DIMS = { w: 640, h: 480 };
const MAX_HISTORY = 25;
const RAISE_THRESHOLD = 0.06; // normalized (0-1) landmark units — resolution-independent by design, see below

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

// Landmark (tip, base/knuckle) pairs for the four fingers whose
// "raised" state can be reliably read via a simple vertical
// tip-vs-knuckle comparison. The thumb is deliberately excluded from
// this check — its natural resting position and range of motion are
// mostly horizontal/rotational rather than vertical, so the same
// "tip above knuckle" test that works for the other four fingers
// doesn't hold for it, and would produce false positives/negatives
// regardless of hand shape.
const FINGER_JOINTS = [
  { name: "index", tip: 8, base: 5 },
  { name: "middle", tip: 12, base: 9 },
  { name: "ring", tip: 16, base: 13 },
  { name: "pinky", tip: 20, base: 17 },
];

// Same check as the fixed Python `finger_raised()`: a fingertip counts as
// "raised" only if it's meaningfully above its own knuckle, not just
// technically higher by a pixel. Using a normalized (0-1) threshold
// rather than a fixed pixel count means this works identically whether
// the camera negotiated 640x480 or a full 1080p feed — a pixel-based
// threshold would've needed rescaling for every resolution.
function fingerRaised(tipY, baseY) {
  return baseY - tipY > RAISE_THRESHOLD;
}

/**
 * Returns every finger (of the four checked) that's currently raised,
 * as [{ name, tip: landmarkIndex }, ...].
 *
 * Accessibility note, worth being honest about: the earlier version of
 * this hardcoded "index finger raised, middle finger down" as the only
 * way to draw — meaning it assumed everyone has, and is using, those
 * two specific fingers. This version checks all four independently and
 * treats "exactly one raised, whichever it is" as the draw gesture, so
 * someone who can raise a different single finger (for any reason —
 * missing digits, limited mobility in a specific finger, etc.) isn't
 * excluded by the gesture design itself.
 *
 * That said, this can only be as good as MediaPipe's underlying hand
 * model allows, and that's a real, separate limitation: the model
 * always outputs a fixed 21 landmark points because that's a fixed
 * shape baked into the network, and it was trained overwhelmingly on
 * typical five-fingered hands. For a hand where a given landmark
 * doesn't correspond to a real fingertip at all (e.g. a missing
 * finger), the model still produces *some* estimated position for it —
 * there's no code-level fix for that; it's a limitation of the
 * detection model itself, not of the gesture rule built on top of it.
 * The pointer/touch drawing mode (see inputMode below) exists
 * specifically as a fallback for when hand-gesture tracking isn't a
 * good fit for a given person's hand at all, rather than trying to
 * force every case through gesture recognition.
 */
function getRaisedFingers(hand) {
  return FINGER_JOINTS.filter((f) => fingerRaised(hand[f.tip].y, hand[f.base].y));
}

/**
 * Owns the camera, the HandLandmarker model, the persistent drawing
 * layer, and undo/redo history. Everything runs client-side in the
 * browser — there is no Python/Streamlit backend in this version at all.
 *
 * Gesture rule (matches the fixed Python app, verified there with a unit
 * test): raise only your index finger to draw; raise index + middle to
 * move without drawing.
 *
 * Camera resolution: requests HD (1280x720) as a *preference*, not a
 * hard requirement — using `ideal` in the constraints tells the browser
 * "get as close to this as the device can," so a laptop webcam that
 * maxes out at 640x480, a phone camera capable of 1080p, and a proper
 * HD webcam all get their own best available resolution, rather than
 * either failing outright (if we required exactly 1280x720) or being
 * needlessly capped at a low fixed resolution (if we'd left the old
 * hardcoded 640x480 requirement in place). The actual negotiated
 * resolution is read back from the live video track once it starts
 * (videoWidth/videoHeight — see setup()) and everything downstream
 * (canvases, drawing coordinates, mirroring) adapts to that, not to a
 * fixed constant.
 */
export function useHandPainter() {
  const videoRef = useRef(null);
  const outputCanvasRef = useRef(null);
  const maskCanvasRef = useRef(null); // offscreen, holds the actual painting (with real alpha transparency)

  const [status, setStatus] = useState("loading"); // loading | ready | tracking | idle | error
  const [errorMessage, setErrorMessage] = useState("");
  const [fps, setFps] = useState(0);
  // Exposed so App.jsx can size the visible canvas/container to match
  // whatever resolution actually got negotiated, instead of assuming a
  // fixed aspect ratio that may not match a given device's camera.
  const [frameSize, setFrameSize] = useState(DEFAULT_DIMS);
  const dimsRef = useRef(DEFAULT_DIMS); // the hot rAF loop reads this directly, not React state, to avoid stale closures

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

  // Accessibility fallback: hand-gesture tracking can only work as well
  // as MediaPipe's underlying model allows for a given hand (see the
  // long comment on getRaisedFingers above). "pointer" mode bypasses
  // hand detection entirely — draw with a mouse, trackpad, or touchscreen
  // instead, for anyone gesture tracking isn't a good fit for, or who
  // simply prefers it. Exposed as inputMode/setInputMode below.
  const [inputMode, setInputMode] = useState("hand"); // "hand" | "pointer"
  const inputModeRef = useRef("hand");
  useEffect(() => { inputModeRef.current = inputMode; }, [inputMode]);
  const pointerStateRef = useRef({ down: false, x: 0, y: 0 });

  const pushHistory = useCallback(() => {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    const { w, h } = dimsRef.current;
    const ctx = mask.getContext("2d");
    const snapshot = ctx.getImageData(0, 0, w, h);
    const hist = historyRef.current;
    hist.stack = hist.stack.slice(0, hist.pos + 1);
    hist.stack.push(snapshot);
    if (hist.stack.length > MAX_HISTORY) hist.stack.shift();
    hist.pos = hist.stack.length - 1;
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
    const { w, h } = dimsRef.current;
    mask.getContext("2d").clearRect(0, 0, w, h);
    pushHistory();
  }, [pushHistory]);

  // The actual "draw/erase/shape" logic, extracted so both hand-gesture
  // input and pointer/touch input drive the exact same code path instead
  // of two separate, potentially-diverging implementations. `active`
  // means "the draw gesture/pointer-down is currently true"; `outCtx` is
  // optional (only needed for the live line/rect/circle preview — pointer
  // input draws that preview too, via the same call from the rAF loop).
  const applyToolAction = useCallback((maskCtx, outCtx, active, x, y) => {
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
        if (outCtx) {
          outCtx.strokeStyle = color;
          outCtx.lineWidth = thickness;
          drawShapePreview(outCtx, tool, ds.shapeAnchor, { x, y });
        }
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
  }, [pushHistory]);

  // Same "hand left the frame mid-stroke" cleanup as before, extracted
  // so it's callable outside the hand-tracking branch too.
  const resetDrawState = useCallback(() => {
    const tool = toolRef.current;
    const ds = drawState.current;
    if (tool === "draw" && (ds.prevX || ds.prevY)) pushHistory();
    ds.prevX = 0; ds.prevY = 0;
    ds.shapeAnchor = null;
  }, [pushHistory]);

  // Pointer/touch handlers for accessibility "pointer" mode — these only
  // record state; the actual drawing happens once per rAF frame in the
  // loop below, the same way hand-tracking does, so continuous strokes
  // and live shape previews behave identically between both input modes.
  const canvasPointToFramePoint = useCallback((e) => {
    const canvas = outputCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }, []);

  const handlePointerDown = useCallback((e) => {
    if (inputModeRef.current !== "pointer") return;
    const { x, y } = canvasPointToFramePoint(e);
    pointerStateRef.current = { down: true, x, y };
  }, [canvasPointToFramePoint]);

  const handlePointerMove = useCallback((e) => {
    if (inputModeRef.current !== "pointer" || !pointerStateRef.current.down) return;
    const { x, y } = canvasPointToFramePoint(e);
    pointerStateRef.current.x = x;
    pointerStateRef.current.y = y;
  }, [canvasPointToFramePoint]);

  const handlePointerUp = useCallback(() => {
    if (inputModeRef.current !== "pointer") return;
    pointerStateRef.current.down = false;
  }, []);

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
    mask.width = DEFAULT_DIMS.w;
    mask.height = DEFAULT_DIMS.h;

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

        // `ideal` (not a hard `min`/exact value) tells the browser "get as
        // close to HD as this device's camera can do" rather than failing
        // outright on a device that can't hit exactly 1280x720 — a phone
        // camera might negotiate higher, an old laptop webcam might only
        // manage 640x480, and both should work rather than one of them
        // throwing OverconstrainedError.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();

        // This is the actual negotiated resolution — not what we asked
        // for, what the device actually delivered. Everything downstream
        // (canvases, drawing math, mirroring) uses this from here on.
        const w = video.videoWidth || DEFAULT_DIMS.w;
        const h = video.videoHeight || DEFAULT_DIMS.h;
        dimsRef.current = { w, h };
        setFrameSize({ w, h });
        mask.width = w;
        mask.height = h;
        if (outputCanvasRef.current) {
          outputCanvasRef.current.width = w;
          outputCanvasRef.current.height = h;
        }

        pushHistory(); // seed history with the blank canvas, at the real resolution
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

      const { w: W, h: H } = dimsRef.current;
      const t0 = performance.now();
      const outCtx = output.getContext("2d");
      const maskCtx = mask.getContext("2d");

      // Mirror the feed so movement feels natural (matches cv2.flip(img, 1)).
      outCtx.save();
      outCtx.translate(W, 0);
      outCtx.scale(-1, 1);
      outCtx.drawImage(video, 0, 0, W, H);
      outCtx.restore();

      const nowMs = performance.now();

      // In pointer mode, skip hand detection entirely — no reason to
      // spend CPU/battery running the model when input isn't coming from
      // gestures at all.
      const result = inputModeRef.current === "hand" ? landmarker.detectForVideo(video, nowMs) : null;

      if (inputModeRef.current === "pointer") {
        setStatus("pointer");
        const ps = pointerStateRef.current;
        applyToolAction(maskCtx, outCtx, ps.down, ps.x, ps.y);
      } else if (result && result.landmarks && result.landmarks.length > 0) {
        setStatus("tracking");
        const hand = result.landmarks[0];

        // draw skeleton (mirrored to match the flipped video)
        outCtx.strokeStyle = "#5EEAD4";
        outCtx.lineWidth = 1;
        for (const [a, b] of HAND_CONNECTIONS) {
          outCtx.beginPath();
          outCtx.moveTo(W - hand[a].x * W, hand[a].y * H);
          outCtx.lineTo(W - hand[b].x * W, hand[b].y * H);
          outCtx.stroke();
        }
        outCtx.fillStyle = "#A78BFA";
        for (const lm of hand) {
          outCtx.beginPath();
          outCtx.arc(W - lm.x * W, lm.y * H, 2, 0, Math.PI * 2);
          outCtx.fill();
        }

        const raised = getRaisedFingers(hand);
        // Exactly one finger raised = draw, regardless of which one.
        // Two or more raised = move without drawing (same "index +
        // middle" idea as before, just generalized to any two fingers).
        // Zero raised = idle, same as a closed fist.
        const active = raised.length === 1;
        // Track whichever finger is actually raised for the cursor
        // position; if none are raised, fall back to the wrist (landmark
        // 0) so the cursor still tracks the hand's general position
        // instead of freezing at a stale coordinate.
        const cursorLandmark = raised.length > 0 ? raised[0].tip : 0;
        const x = W - hand[cursorLandmark].x * W;
        const y = hand[cursorLandmark].y * H;

        applyToolAction(maskCtx, outCtx, active, x, y);
      } else {
        // Same fix as the Python version: losing hand tracking mid-stroke
        // must not leave stale coordinates around, or the next detected
        // frame draws a stray line from the old position to the new one.
        setStatus("ready");
        resetDrawState();
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
    status, errorMessage, fps, frameSize,
    tool, setTool, color, setColor, thickness, setThickness,
    undo, redo, clear, downloadPainting, saveToCloud, saveState,
    canUndo, canRedo, historyTick,
    inputMode, setInputMode, handlePointerDown, handlePointerMove, handlePointerUp,
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
