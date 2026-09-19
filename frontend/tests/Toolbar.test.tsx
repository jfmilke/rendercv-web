import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Toolbar } from "../src/components/Toolbar";

function setup(overrides = {}) {
  const props = {
    onUploadYaml: vi.fn(),
    onDownloadYaml: vi.fn(),
    onDownloadPdf: vi.fn(),
    onGenerate: vi.fn(),
    isGenerating: false,
    hasPdf: false,
    ...overrides,
  };
  render(<Toolbar {...props} />);
  return props;
}

describe("Toolbar", () => {
  it("calls onGenerate when the Generate PDF button is clicked", () => {
    const props = setup();
    fireEvent.click(screen.getByText("Generate PDF"));
    expect(props.onGenerate).toHaveBeenCalledOnce();
  });

  it("disables Generate PDF while generating", () => {
    setup({ isGenerating: true });
    expect(screen.getByText("Generating...")).toBeDisabled();
  });

  it("disables Download PDF until a PDF exists", () => {
    setup({ hasPdf: false });
    expect(screen.getByText("Download PDF")).toBeDisabled();
  });

  it("enables Download PDF once a PDF exists", () => {
    setup({ hasPdf: true });
    expect(screen.getByText("Download PDF")).not.toBeDisabled();
  });

  it("reads an uploaded file and calls onUploadYaml with its text content", async () => {
    const props = setup();
    const file = new File(["cv:\n  name: Test"], "cv.yaml", { type: "text/yaml" });
    const input = screen.getByLabelText("Upload YAML", { selector: "input" });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(props.onUploadYaml).toHaveBeenCalledWith("cv:\n  name: Test")
    );
  });
});
