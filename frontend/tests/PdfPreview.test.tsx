import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfPreview } from "../src/components/PdfPreview";

vi.mock("react-pdf", () => ({
  Document: ({ children, onLoadSuccess }: any) => {
    onLoadSuccess({ numPages: 2 });
    return <div data-testid="pdf-document">{children}</div>;
  },
  Page: ({ pageNumber }: any) => <div data-testid="pdf-page">{`page-${pageNumber}`}</div>,
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
});
