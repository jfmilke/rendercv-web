import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface PdfPreviewProps {
  pdfDataUrl: string | null;
}

export function PdfPreview({ pdfDataUrl }: PdfPreviewProps) {
  const [numPages, setNumPages] = useState(0);

  if (!pdfDataUrl) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl bg-panel-bg text-gray-500">
        Generate a PDF to see the preview here.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto rounded-xl bg-panel-bg p-3">
      <Document file={pdfDataUrl} onLoadSuccess={({ numPages: count }) => setNumPages(count)}>
        {Array.from({ length: numPages }, (_, index) => (
          <Page key={index} pageNumber={index + 1} className="mb-3" />
        ))}
      </Document>
    </div>
  );
}
