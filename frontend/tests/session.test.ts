import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { getOrCreateSessionId } from "../src/lib/session";

describe("getOrCreateSessionId", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a new session id when none is stored", () => {
    const id = getOrCreateSessionId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns the same id on subsequent calls", () => {
    const first = getOrCreateSessionId();
    const second = getOrCreateSessionId();
    expect(second).toBe(first);
  });

  it("falls back to a non-crypto id when crypto.randomUUID is unavailable", () => {
    // Plain-HTTP (non-secure-context) deployments have no crypto.randomUUID.
    vi.stubGlobal("crypto", {});

    const id = getOrCreateSessionId();

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThanOrEqual(16);
    expect(sessionStorage.getItem("rendercv-web-session-id")).toBe(id);
  });

  it("produces distinct ids from the fallback path", () => {
    vi.stubGlobal("crypto", undefined);

    const ids = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      sessionStorage.clear();
      ids.add(getOrCreateSessionId());
    }

    expect(ids.size).toBe(50);
  });
});
