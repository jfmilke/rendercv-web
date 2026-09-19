import { describe, expect, it, beforeEach } from "vitest";
import { getOrCreateSessionId } from "../src/lib/session";

describe("getOrCreateSessionId", () => {
  beforeEach(() => {
    sessionStorage.clear();
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
});
