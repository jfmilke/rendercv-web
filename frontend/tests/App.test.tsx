import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import App from "../src/App";
import * as api from "../src/lib/api";

vi.mock("../src/components/YamlEditor", () => ({
  YamlEditor: ({ value, onChange }: any) => (
    <textarea
      aria-label="yaml-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock("../src/components/PdfPreview", () => ({
  PdfPreview: ({ pdfDataUrl }: any) => (
    <div data-testid="pdf-preview">{pdfDataUrl ?? "empty"}</div>
  ),
}));

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(api, "fetchVersion").mockResolvedValue("2.8");
    vi.spyOn(api, "fetchConfig").mockResolvedValue({ imageUploadEnabled: false });
  });

  it("shows the generated PDF after a successful render", async () => {
    vi.spyOn(api, "streamRender").mockImplementation(async function* () {
      yield { type: "log", line: "Compiling..." };
      yield { type: "result", status: "success", pdfBase64: "AAAA" };
    });

    render(<App />);
    fireEvent.click(screen.getByText("Generate PDF"));

    expect(await screen.findByText("Compiling...")).toBeInTheDocument();
    expect(await screen.findByTestId("pdf-preview")).toHaveTextContent(
      "data:application/pdf;base64,AAAA"
    );
  });

  it("shows the image upload control only when the backend reports it enabled", async () => {
    vi.spyOn(api, "fetchConfig").mockResolvedValue({ imageUploadEnabled: true });
    render(<App />);
    expect(await screen.findByText("Upload photo")).toBeInTheDocument();
  });
});
