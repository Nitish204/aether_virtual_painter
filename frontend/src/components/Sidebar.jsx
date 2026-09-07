const TOOLS = [
  { id: "draw", label: "Freehand Draw", icon: "✏️" },
  { id: "line", label: "Straight Line", icon: "／" },
  { id: "rectangle", label: "Rectangle", icon: "▭" },
  { id: "circle", label: "Circle", icon: "◯" },
  { id: "erase", label: "Eraser", icon: "⌫" },
];

const PALETTE = [
  { name: "Signal Red", hex: "#FF3C3C" },
  { name: "Aether Cyan", hex: "#5EEAD4" },
  { name: "Voltage Violet", hex: "#A78BFA" },
  { name: "Alert Amber", hex: "#FFB000" },
  { name: "Mint", hex: "#A1E3A6" },
  { name: "Pure White", hex: "#FFFFFF" },
];

function Label({ children }) {
  return (
    <div
      className="mono"
      style={{
        fontSize: "0.7rem",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--muted)",
        marginBottom: 8,
        marginTop: 18,
      }}
    >
      {children}
    </div>
  );
}

export default function Sidebar({
  tool, setTool, color, setColor, thickness, setThickness,
  undo, redo, clear, canUndo, canRedo, downloadPainting, canDownload,
  saveToCloud, saveState, onOpenGallery, user, onLogout,
}) {
  return (
    <div
      style={{
        width: 280,
        flexShrink: 0,
        background: "var(--surface)",
        borderLeft: "1px solid var(--border)",
        padding: "20px 18px",
        overflowY: "auto",
      }}
    >
      {user && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <span className="mono" style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{user.email}</span>
          <button onClick={onLogout} className="mono" style={{ background: "none", border: "none", color: "var(--muted)", fontSize: "0.7rem", padding: 0 }}>
            Sign out
          </button>
        </div>
      )}

      <Label>Tool</Label>
      {/* Sliding active-tool indicator: a single moving pill behind
          whichever tool is selected, rather than a fade/hover effect on
          every row — motion here answers the user's own click. */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 4 }}>
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            className="mono"
            style={{
              position: "relative",
              zIndex: 1,
              textAlign: "left",
              padding: "9px 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: tool === t.id ? "var(--surface-2)" : "transparent",
              color: tool === t.id ? "var(--cyan)" : "var(--text)",
              borderColor: tool === t.id ? "var(--cyan)" : "var(--border)",
              fontSize: "0.85rem",
              transition: "background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.15s ease",
            }}
            onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
            onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
          >
            {t.icon}&nbsp;&nbsp;{t.label}
          </button>
        ))}
      </div>

      <Label>Color</Label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {PALETTE.map((c) => (
          <button
            key={c.hex}
            title={c.name}
            onClick={() => setColor(c.hex)}
            style={{
              width: 30, height: 30, borderRadius: "50%",
              background: c.hex,
              border: color === c.hex ? "2.5px solid #fff" : "2px solid var(--border)",
              boxShadow: color === c.hex ? `0 0 0 3px ${c.hex}55` : "none",
              transition: "box-shadow 0.18s ease, border-color 0.18s ease, transform 0.15s ease",
              transform: color === c.hex ? "scale(1.08)" : "scale(1)",
            }}
          />
        ))}
      </div>

      <Label>Stroke Thickness</Label>
      <input
        type="range"
        min={1}
        max={30}
        value={thickness}
        onChange={(e) => setThickness(Number(e.target.value))}
        style={{ width: "100%", accentColor: "var(--cyan)" }}
      />
      <div className="mono" style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: 4 }}>
        {thickness}px
      </div>

      <Label>History</Label>
      <div style={{ display: "flex", gap: 6 }}>
        <SidebarButton onClick={undo} disabled={!canUndo}>↶ Undo</SidebarButton>
        <SidebarButton onClick={redo} disabled={!canRedo}>↷ Redo</SidebarButton>
        <SidebarButton onClick={clear}>✕ Clear</SidebarButton>
      </div>

      <Label>Export</Label>
      <SidebarButton onClick={downloadPainting} disabled={!canDownload} full>
        ⬇ Download Painting (PNG)
      </SidebarButton>
      <div style={{ height: 6 }} />
      <SidebarButton onClick={saveToCloud} disabled={!canDownload || saveState === "saving"} full>
        {saveState === "saving" ? "Saving..." : saveState === "saved" ? "✓ Saved" : saveState === "error" ? "Couldn't save — retry?" : "☁ Save to Cloud"}
      </SidebarButton>
      <div style={{ height: 6 }} />
      <SidebarButton onClick={onOpenGallery} full>
        🖼 View My Paintings
      </SidebarButton>

      <Label>How it works</Label>
      <div className="mono" style={{ fontSize: "0.78rem", color: "var(--muted)", lineHeight: 1.7 }}>
        1. Allow camera access above<br />
        2. Raise <b style={{ color: "var(--cyan)" }}>only your index finger</b> to draw<br />
        3. Raise index + middle to move without drawing<br />
        4. Pick tool / color / thickness here anytime
      </div>
    </div>
  );
}

function SidebarButton({ children, onClick, disabled, full }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="mono"
      style={{
        flex: full ? "1 1 100%" : 1,
        padding: "8px 10px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--surface-2)",
        color: disabled ? "var(--muted)" : "var(--text)",
        fontSize: "0.78rem",
        opacity: disabled ? 0.5 : 1,
        transition: "border-color 0.15s ease, color 0.15s ease, transform 0.12s ease",
      }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.borderColor = "var(--cyan)"; e.currentTarget.style.color = "var(--cyan)"; } }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = disabled ? "var(--muted)" : "var(--text)"; }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = "scale(0.96)"; }}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
    >
      {children}
    </button>
  );
}
