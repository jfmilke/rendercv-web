import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GenerateControls } from "../src/components/GenerateControls";

function setup(overrides = {}) {
  const props = {
    onDownloadPdf: vi.fn(),
    onGenerate: vi.fn(),
    isGenerating: false,
    hasPdf: false,
    ...overrides,
  };
  render(<GenerateControls {...props} />);
  return props;
}

describe("GenerateControls", () => {
  it("calls onGenerate when the Generate PDF button is clicked", () => {
    const props = setup();
    screen.getByText("Generate PDF").click();
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
});
