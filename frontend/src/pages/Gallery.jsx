import { useEffect, useState } from "react";
import { apiFetch } from "../utils/api";

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
    " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function GalleryCard({ item, onDelete }) {
  const [imageSrc, setImageSrc] = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/drawings/${item.id}`)
      .then((res) => res.json())
      .then((data) => { if (!cancelled) setImageSrc(`data:image/png;base64,${data.image_base64}`); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [item.id]);

  return (
    <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ aspectRatio: "4 / 3", background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {imageSrc
          ? <img src={imageSrc} alt="Saved painting" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          : <div className="spinner" style={{ width: 20, height: 20, border: "2px solid var(--border)", borderTopColor: "var(--cyan)", borderRadius: "50%" }} />}
      </div>
      <div style={{ padding: "10px 12px" }}>
        <div className="mono" style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{formatDate(item.created_at)}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: item.color, border: "1px solid var(--border)" }} />
            <span className="mono" style={{ fontSize: "0.72rem", color: "var(--text)" }}>{item.tool} · {item.thickness}px</span>
          </div>
          <button
            onClick={() => onDelete(item.id)}
            className="mono"
            style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--muted)", fontSize: "0.68rem", padding: "3px 7px" }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Gallery({ onBackToPainter }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");

  function load() {
    apiFetch("/api/drawings")
      .then((res) => res.json())
      .then(setItems)
      .catch(() => setError("Couldn't load your paintings."));
  }

  useEffect(load, []);

  async function handleDelete(id) {
    setItems((prev) => prev.filter((i) => i.id !== id)); // optimistic
    try {
      const res = await apiFetch(`/api/drawings/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      load(); // roll back by reloading if the delete actually failed
    }
  }

  return (
    <div className="rise-in" style={{ padding: "24px 28px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h2 style={{ fontSize: "1.4rem" }}>Your paintings</h2>
        <button
          onClick={onBackToPainter}
          className="mono"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontSize: "0.8rem", padding: "8px 14px" }}
        >
          ← Back to canvas
        </button>
      </div>

      {error && <div className="mono" style={{ color: "#ff6b5c", fontSize: "0.85rem" }}>{error}</div>}

      {items === null && !error && (
        <div className="mono" style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Loading...</div>
      )}

      {items && items.length === 0 && (
        <div className="mono" style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          No paintings saved yet — draw something and hit "Save to Cloud."
        </div>
      )}

      {items && items.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
          {items.map((item) => (
            <GalleryCard key={item.id} item={item} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
