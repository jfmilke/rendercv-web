const SESSION_STORAGE_KEY = "rendercv-web-session-id";

function randomId(): string {
  // `crypto.randomUUID` only exists in a secure context (HTTPS or localhost).
  // A self-hosted deployment reached over plain HTTP on a LAN has none, and an
  // unguarded call there throws before the app can render at all. The session
  // id is an opaque server-side cache key, never a security token, so a
  // non-cryptographic fallback is fine.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const chunk = () => Math.random().toString(36).slice(2).padStart(11, "0");
  return `${chunk()}${chunk()}${Date.now().toString(36)}`;
}

export function getOrCreateSessionId(): string {
  const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) {
    return existing;
  }
  const generated = randomId();
  sessionStorage.setItem(SESSION_STORAGE_KEY, generated);
  return generated;
}
