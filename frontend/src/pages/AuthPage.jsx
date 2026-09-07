import { useState } from "react";
import { apiFetch } from "../utils/api";

export default function AuthPage({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await apiFetch(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Something went wrong.");
      onAuthenticated(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rise-in" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <form
        onSubmit={handleSubmit}
        style={{
          width: 340, background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 14, padding: "28px 26px",
        }}
      >
        <h2 style={{ background: "linear-gradient(90deg, var(--cyan), var(--violet))", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", fontSize: "1.5rem", marginBottom: 4 }}>
          AETHER
        </h2>
        <p className="mono" style={{ fontSize: "0.78rem", color: "var(--muted)", marginBottom: 20 }}>
          {mode === "login" ? "Sign in to see your saved paintings." : "Create an account to save your paintings."}
        </p>

        <label className="mono" style={{ fontSize: "0.72rem", color: "var(--muted)", textTransform: "uppercase" }}>Email</label>
        <input
          type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />

        <label className="mono" style={{ fontSize: "0.72rem", color: "var(--muted)", textTransform: "uppercase", marginTop: 12, display: "block" }}>Password</label>
        <input
          type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />

        {error && (
          <div className="mono" style={{ marginTop: 12, fontSize: "0.78rem", color: "#ff6b5c" }}>{error}</div>
        )}

        <button
          type="submit" disabled={loading}
          className="mono"
          style={{
            width: "100%", marginTop: 18, padding: "10px 14px", borderRadius: 8,
            border: "1px solid var(--cyan)", background: "rgba(94,234,212,0.1)", color: "var(--cyan)",
            fontSize: "0.85rem", opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
        </button>

        <div className="mono" style={{ textAlign: "center", marginTop: 16, fontSize: "0.78rem", color: "var(--muted)" }}>
          {mode === "login" ? "Don't have an account? " : "Already have an account? "}
          <button
            type="button"
            onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
            style={{ background: "none", border: "none", color: "var(--cyan)", padding: 0, fontSize: "0.78rem" }}
          >
            {mode === "login" ? "Create one" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputStyle = {
  width: "100%", marginTop: 4, padding: "9px 11px", borderRadius: 8,
  border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)",
  fontSize: "0.88rem", fontFamily: "'Inter', sans-serif",
};
