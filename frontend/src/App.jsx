import { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import StatusPanel from "./components/StatusPanel";
import { useHandPainter } from "./hooks/useHandPainter";
import { apiFetch } from "./utils/api";
import AuthPage from "./pages/AuthPage";
import Gallery from "./pages/Gallery";

// Fallback only, used for the very first paint before the camera
// reports its real negotiated resolution (p.frameSize from the hook
// below then takes over — see the canvas/container sizing further down).
const DEFAULT_FRAME_W = 640;
const DEFAULT_FRAME_H = 480;

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = signed out, object = signed in
  const [view, setView] = useState("painter"); // "painter" | "gallery"

  useEffect(() => {
    apiFetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  async function handleLogout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setView("painter");
  }

  if (user === undefined) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }} className="mono">
        Loading...
      </div>
    );
  }

  if (!user) {
    return <AuthPage onAuthenticated={setUser} />;
  }

  if (view === "gallery") {
    return <Gallery onBackToPainter={() => setView("painter")} />;
  }

  return <Painter user={user} onLogout={handleLogout} onOpenGallery={() => setView("gallery")} />;
}

function Painter({ user, onLogout, onOpenGallery }) {
  const p = useHandPainter();

  return (
    <div style={{ minHeight: "100vh", padding: "24px 28px" }}>
      <div className="rise-in" style={{ display: "flex", alignItems: "center", gap: 22, padding: "22px 26px", marginBottom: 20, background: "linear-gradient(135deg, rgba(94,234,212,0.06), rgba(167,139,250,0.05))", border: "1px solid var(--border)", borderRadius: 14 }}>
        <HeroMark />
        <div>
          <h1 style={{ fontSize: "2.1rem", fontWeight: 700, background: "linear-gradient(90deg, var(--cyan), var(--violet))", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
            AETHER
          </h1>
          <p className="mono" style={{ fontSize: "0.82rem", color: "var(--muted)", marginTop: 6, letterSpacing: "0.02em" }}>
            DRAW ON THIN AIR · REAL-TIME HAND-LANDMARK TRACKING · RUNS ENTIRELY IN YOUR BROWSER
          </p>
          <span className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.72rem", color: "var(--cyan)", background: "rgba(94,234,212,0.08)", border: "1px solid rgba(94,234,212,0.25)", padding: "3px 10px", borderRadius: 100, marginTop: 10 }}>
            <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--cyan)", boxShadow: "0 0 6px var(--cyan)" }} />
            LIVE MODEL RUNNING ON-DEVICE
          </span>
        </div>
      </div>

      <div className="rise-in" style={{ animationDelay: "0.08s", display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ position: "relative", width: "100%", maxWidth: p.frameSize?.w || DEFAULT_FRAME_W, aspectRatio: `${p.frameSize?.w || DEFAULT_FRAME_W} / ${p.frameSize?.h || DEFAULT_FRAME_H}`, borderRadius: 14, overflow: "hidden", border: "1px solid var(--border)", background: "#000" }}>
            {/* Bug fix: `display: "none"` removes an element from the
                render tree entirely, and in a lot of browsers (Chrome
                and Safari both do this) a <video> element that isn't
                actually laid out on the page stops decoding frames —
                readyState never advances past HAVE_NOTHING even though
                the stream is technically attached and "playing". That
                produces exactly this symptom: camera permission is
                granted, but the canvas draw loop waits forever for a
                frame that's never decoded. Positioning it off-screen
                (rather than display:none) keeps it genuinely rendered,
                so the browser keeps decoding it, while still being
                fully invisible to the user — only the canvas below is
                what they actually see. */}
            <video
              ref={p.videoRef}
              playsInline
              muted
              style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none", top: 0, left: 0 }}
            />
            <canvas
              ref={p.outputCanvasRef}
              width={p.frameSize?.w || DEFAULT_FRAME_W}
              height={p.frameSize?.h || DEFAULT_FRAME_H}
              style={{ width: "100%", height: "100%", display: "block", touchAction: "none", cursor: p.inputMode === "pointer" ? "crosshair" : "default" }}
              onPointerDown={p.handlePointerDown}
              onPointerMove={p.handlePointerMove}
              onPointerUp={p.handlePointerUp}
              onPointerLeave={p.handlePointerUp}
            />
            <canvas ref={p.maskCanvasRef} style={{ display: "none" }} />

            {p.status === "loading" && <Overlay><Spinner /><span>Loading hand-tracking model...</span></Overlay>}
            {p.status === "error" && <Overlay><span style={{ color: "#ff6b5c" }}>{p.errorMessage}</span></Overlay>}

            <div className="mono" style={{ position: "absolute", left: 12, bottom: 12, fontSize: "0.72rem", color: "#fff", background: "rgba(0,0,0,0.4)", padding: "2px 8px", borderRadius: 6 }}>
              {p.tool.toUpperCase()}
            </div>
            <div className="mono" style={{ position: "absolute", left: 12, bottom: 38, fontSize: "0.65rem", color: "#ccc", background: "rgba(0,0,0,0.4)", padding: "2px 8px", borderRadius: 6 }}>
              {p.fps} FPS
            </div>
            <div className="mono" style={{ position: "absolute", right: 12, bottom: 12, fontSize: "0.65rem", color: "#ccc", background: "rgba(0,0,0,0.4)", padding: "2px 8px", borderRadius: 6 }}>
              {p.frameSize ? `${p.frameSize.w}×${p.frameSize.h}` : "..."}
            </div>
          </div>
        </div>

        <StatusPanel status={p.status} fps={p.fps} tool={p.tool} thickness={p.thickness} color={p.color} />

        <Sidebar
          tool={p.tool} setTool={p.setTool}
          color={p.color} setColor={p.setColor}
          thickness={p.thickness} setThickness={p.setThickness}
          undo={p.undo} redo={p.redo} clear={p.clear}
          canUndo={p.canUndo} canRedo={p.canRedo}
          downloadPainting={p.downloadPainting} canDownload={p.status !== "loading" && p.status !== "error"}
          saveToCloud={p.saveToCloud} saveState={p.saveState}
          onOpenGallery={onOpenGallery} user={user} onLogout={onLogout}
          inputMode={p.inputMode} setInputMode={p.setInputMode}
        />
      </div>

      <p className="mono" style={{ fontSize: "0.72rem", color: "var(--muted)", textAlign: "center", marginTop: 18 }}>
        AETHER · MediaPipe (WASM) + Canvas + React · No server-side camera access — video never leaves your browser
      </p>
    </div>
  );
}

function Overlay({ children }) {
  return (
    <div className="mono" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "var(--text)", background: "rgba(11,14,20,0.9)", fontSize: "0.85rem", textAlign: "center", padding: 20 }}>
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <div className="spinner" style={{ width: 24, height: 24, border: "2.5px solid var(--border)", borderTopColor: "var(--cyan)", borderRadius: "50%" }} />
  );
}

function HeroMark() {
  return (
    <svg width="60" height="60" viewBox="0 0 86 86" style={{ flexShrink: 0 }}>
      <g stroke="#5EEAD4" strokeWidth="1.4" fill="none" opacity="0.9">
        <line x1="43" y1="70" x2="30" y2="46" />
        <line x1="43" y1="70" x2="43" y2="40" />
        <line x1="43" y1="70" x2="56" y2="42" />
        <line x1="43" y1="70" x2="66" y2="50" />
        <line x1="30" y1="46" x2="26" y2="20" />
        <line x1="43" y1="40" x2="41" y2="12" />
        <line x1="56" y1="42" x2="58" y2="16" />
        <line x1="66" y1="50" x2="74" y2="34" />
      </g>
      <g fill="#A78BFA">
        <circle cx="43" cy="70" r="3.4" />
        <circle cx="30" cy="46" r="2.4" /><circle cx="26" cy="20" r="2.4" />
        <circle cx="43" cy="40" r="2.4" /><circle cx="41" cy="12" r="2.4" />
        <circle cx="56" cy="42" r="2.4" /><circle cx="58" cy="16" r="2.4" />
        <circle cx="66" cy="50" r="2.4" /><circle cx="74" cy="34" r="2.4" />
      </g>
    </svg>
  );
}
