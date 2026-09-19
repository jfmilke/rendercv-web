const SESSION_STORAGE_KEY = "rendercv-web-session-id";

export function getOrCreateSessionId(): string {
  const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) {
    return existing;
  }
  const generated = crypto.randomUUID();
  sessionStorage.setItem(SESSION_STORAGE_KEY, generated);
  return generated;
}
