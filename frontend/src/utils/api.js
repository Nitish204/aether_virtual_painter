export const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

function getCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Fetch wrapper that always sends the httpOnly session cookie and
 * automatically attaches the CSRF header (double-submit pattern) on
 * any state-changing request — same approach already verified in Nexus.
 */
export async function apiFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const method = (options.method || "GET").toUpperCase();
  if (method !== "GET") {
    const csrf = getCookie("aether_csrf");
    if (csrf) headers["x-csrf-token"] = csrf;
  }
  return fetch(`${API_BASE}${path}`, { ...options, headers, credentials: "include" });
}
