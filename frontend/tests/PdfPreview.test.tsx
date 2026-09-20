import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PdfPreview } from "../src/components/PdfPreview";

vi.mock("react-pdf", () => ({
  Document: ({ children, onLoadSuccess }: any) => {
    onLoadSuccess({ numPages: 2 });
    return <div data-testid="pdf-document">{children}</div>;
  },
  Page: ({ pageNumber, scale }: any) => (
    <div data-testid="pdf-page" data-scale={scale}>{`page-${pageNumber}`}</div>
  ),
  pdfjs: { GlobalWorkerOptions: {} },
}));

describe("PdfPreview", () => {
  it("shows a placeholder when there is no PDF yet", () => {
    render(<PdfPreview pdfDataUrl={null} />);
    expect(screen.getByText("Generate a PDF to see the preview here.")).toBeInTheDocument();
  });

  it("renders one Page per reported page count once a PDF is loaded", () => {
    render(<PdfPreview pdfDataUrl="data:application/pdf;base64,AAAA" />);
    expect(screen.getAllByTestId("pdf-page")).toHaveLength(2);
  });

  describe("fullscreen toggle", () => {
    const requestFullscreen = vi.fn();

    beforeEach(() => {
      Object.defineProperty(document, "fullscreenEnabled", {
        value: true,
        configurable: true,
      });
      HTMLElement.prototype.requestFullscreen = requestFullscreen;
      document.exitFullscreen = vi.fn();
    });

    afterEach(() => {
      requestFullscreen.mockClear();
      Object.defineProperty(document, "fullscreenEnabled", {
        value: false,
        configurable: true,
      });
    });

    it("is not shown when there is no PDF yet", () => {
      render(<PdfPreview pdfDataUrl={null} />);
      expect(screen.queryByRole("button", { name: "View fullscreen" })).not.toBeInTheDocument();
    });

    it("is not shown when the browser doesn't support the Fullscreen API", () => {
      Object.defineProperty(document, "fullscreenEnabled", { value: false, configurable: true });
      render(<PdfPreview pdfDataUrl="data:application/pdf;base64,AAAA" />);
      expect(screen.queryByRole("button", { name: "View fullscreen" })).not.toBeInTheDocument();
    });

    it("requests fullscreen on the preview container when clicked", () => {
      render(<PdfPreview pdfDataUrl="data:application/pdf;base64,AAAA" />);
      fireEvent.click(screen.getByRole("button", { name: "View fullscreen" }));
      expect(requestFullscreen).toHaveBeenCalledOnce();
    });
  });

  describe("wheel zoom", () => {
    it("zooms in on Ctrl+wheel and shows the zoom percentage", () => {
      render(<PdfPreview pdfDataUrl="data:application/pdf;base64,AAAA" />);
      fireEvent.wheel(screen.getByTestId("pdf-scroll"), { deltaY: -100, ctrlKey: true });

      const scale = Number(screen.getAllByTestId("pdf-page")[0].dataset.scale);
      expect(scale).toBeGreaterThan(1);
      expect(screen.getByText(`${Math.round(scale * 100)}%`)).toBeInTheDocument();
    });

    it("zooms out on Ctrl+wheel in the other direction", () => {
      render(<PdfPreview pdfDataUrl="data:application/pdf;base64,AAAA" />);
      fireEvent.wheel(screen.getByTestId("pdf-scroll"), { deltaY: 100, ctrlKey: true });

      const scale = Number(screen.getAllByTestId("pdf-page")[0].dataset.scale);
      expect(scale).toBeLessThan(1);
    });

    it("ignores a plain wheel scroll (no Ctrl) and leaves the zoom unchanged", () => {
      render(<PdfPreview pdfDataUrl="data:application/pdf;base64,AAAA" />);
      fireEvent.wheel(screen.getByTestId("pdf-scroll"), { deltaY: -100, ctrlKey: false });

      expect(screen.getAllByTestId("pdf-page")[0].dataset.scale).toBe("1");
      expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
    });

    it("prevents the default browser page-zoom on Ctrl+wheel", () => {
      render(<PdfPreview pdfDataUrl="data:application/pdf;base64,AAAA" />);
      const event = new WheelEvent("wheel", {
        deltaY: -100,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      screen.getByTestId("pdf-scroll").dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });

    it("snaps to 1% steps, ignoring a single tick too small to cross one", () => {
      render(<PdfPreview pdfDataUrl="data:application/pdf;base64,AAAA" />);
      const scroll = screen.getByTestId("pdf-scroll");

      fireEvent.wheel(scroll, { deltaY: -1, ctrlKey: true });
      expect(screen.getAllByTestId("pdf-page")[0].dataset.scale).toBe("1");
      expect(screen.queryByText(/%$/)).not.toBeInTheDocument();

      for (let i = 0; i < 19; i += 1) {
        fireEvent.wheel(scroll, { deltaY: -1, ctrlKey: true });
      }
      const scale = screen.getAllByTestId("pdf-page")[0].dataset.scale;
      expect(scale).toBe("1.02");
      expect(Number(scale) * 100).toBe(Math.round(Number(scale) * 100));
      expect(screen.getByText("102%")).toBeInTheDocument();
    });
  });
});
