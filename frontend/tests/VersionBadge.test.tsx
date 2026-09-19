import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VersionBadge } from "../src/components/VersionBadge";
import * as api from "../src/lib/api";

describe("VersionBadge", () => {
  it("shows the fetched rendercv version", async () => {
    vi.spyOn(api, "fetchVersion").mockResolvedValue("2.8");
    render(<VersionBadge />);
    expect(await screen.findByText("rendercv v2.8")).toBeInTheDocument();
  });

  it("shows a fallback message if the version fetch fails", async () => {
    vi.spyOn(api, "fetchVersion").mockRejectedValue(new Error("network error"));
    render(<VersionBadge />);
    expect(await screen.findByText("rendercv version unavailable")).toBeInTheDocument();
  });
});
