function Chip({ value, label, color }) {
  return (
    <div style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
      <div className="mono" style={{ fontSize: "1.05rem", fontWeight: 600, color: color || "var(--cyan)" }}>{value}</div>
      <div className="mono" style={{ fontSize: "0.65rem", color: "var(--muted)", textTransform: "uppercase", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Panel({ label, children }) {
  return (
    <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px", marginBottom: 14 }}>
      <div className="mono" style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 8 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

export default function StatusPanel({ status, fps, tool, thickness, color }) {
  const isTracking = status === "tracking";
  const statusText = status === "tracking" ? "TRACKING" : status === "ready" ? "IDLE" : status === "error" ? "ERROR" : "STARTING";
  const statusColor = status === "tracking" ? "var(--cyan)" : status === "error" ? "#ff6b5c" : "var(--muted)";

  return (
    <div style={{ width: 260, flexShrink: 0 }}>
      <Panel label="Session Status">
        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          <Chip value={statusText} label="status" color={statusColor} />
          <Chip value={tool.toUpperCase()} label="tool" />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Chip value={`${thickness}px`} label="thickness" />
          <Chip value="■" label={color.toUpperCase()} color={color} />
        </div>
      </Panel>

      <Panel label="Pipeline">
        <div className="mono" style={{ fontSize: "0.76rem", color: "var(--muted)", lineHeight: 1.9 }}>
          Browser camera <span style={{ color: "var(--cyan)" }}>→</span> getUserMedia<br />
          <span style={{ color: "var(--cyan)" }}>→</span> MediaPipe HandLandmarker (WASM, in-browser)<br />
          <span style={{ color: "var(--cyan)" }}>→</span> Gesture state machine (React)<br />
          <span style={{ color: "var(--cyan)" }}>→</span> Canvas compositing<br />
          <span style={{ color: "var(--cyan)" }}>{fps} fps</span>
        </div>
      </Panel>

      <div className="mono" style={{ fontSize: "0.72rem", color: "var(--muted)", textAlign: "center", marginTop: 8 }}>
        Runs entirely in your browser — no server ever sees your camera.
      </div>
    </div>
  );
}
