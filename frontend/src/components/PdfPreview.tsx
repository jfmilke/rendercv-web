import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_SENSITIVITY = 0.001;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function ExpandIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 2H2v4" />
      <path d="M10 2h4v4" />
      <path d="M14 10v4h-4" />
      <path d="M2 10v4h4" />
    </svg>
  );
}

function CompressIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2 6h4V2" />
      <path d="M14 6h-4V2" />
      <path d="M14 10h-4v4" />
      <path d="M2 10h4v4" />
    </svg>
  );
}

interface PdfPreviewProps {
  pdfDataUrl: string | null;
}

export function PdfPreview({ pdfDataUrl }: PdfPreviewProps) {
  const [numPages, setNumPages] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Tracks the continuous zoom level between 1%-steps so fast wheel/pinch
  // input isn't lost between commits (see the effect below).
  const rawZoomRef = useRef(1);
  // Read from a wheel listener's closure without re-subscribing it on every
  // render (see the effect below).
  const pdfDataUrlRef = useRef(pdfDataUrl);
  pdfDataUrlRef.current = pdfDataUrl;
  // Only offer the fullscreen toggle where the browser genuinely supports it
  // (e.g. not iOS Safari, which restricts the Fullscreen API to <video>).
  const supportsFullscreen = document.fullscreenEnabled === true;

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    // Ctrl+wheel is how both "hold Ctrl and scroll" and a trackpad pinch are
    // reported. React's onWheel is passive (preventDefault is a no-op there),
    // so this has to be a real, non-passive DOM listener to actually stop the
    // browser from zooming the whole page instead.
    function handleWheel(event: WheelEvent) {
      if (!event.ctrlKey || !pdfDataUrlRef.current) {
        return;
      }
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * ZOOM_SENSITIVITY);
      const next = clamp(rawZoomRef.current * factor, MIN_ZOOM, MAX_ZOOM);
      rawZoomRef.current = next;
      // Re-rasterizing the PDF canvas on every wheel tick (there can be
      // dozens per second from a trackpad) is what causes the zoom to
      // flicker. Snapping to 1% steps means most ticks just accumulate here
      // without triggering a re-render at all.
      const stepped = Math.round(next * 100) / 100;
      setZoom((current) => (current === stepped ? current : stepped));
    }
    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleWheel);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void containerRef.current?.requestFullscreen();
    }
  }

  return (
    <div ref={containerRef} className="relative h-full bg-page">
      {pdfDataUrl && supportsFullscreen && (
        <button
          onClick={toggleFullscreen}
          className="absolute right-3 top-3 z-10 rounded-sm border border-rule bg-surface/90 p-1.5
            text-ink-soft transition-colors duration-150 hover:border-accent hover:text-accent
            focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          aria-label={isFullscreen ? "Exit fullscreen" : "View fullscreen"}
          title={isFullscreen ? "Exit fullscreen" : "View fullscreen"}
        >
          {isFullscreen ? <CompressIcon /> : <ExpandIcon />}
        </button>
      )}
      {pdfDataUrl && zoom !== 1 && (
        <span
          className="absolute bottom-3 right-3 z-10 rounded-sm border border-rule bg-surface/90 px-2 py-1
            font-serif text-xs text-ink-soft"
        >
          {Math.round(zoom * 100)}%
        </span>
      )}
      <div ref={scrollRef} data-testid="pdf-scroll" className="h-full overflow-auto px-6 py-6">
        {!pdfDataUrl ? (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <p className="font-serif italic text-muted">Generate a PDF to see the preview here.</p>
          </div>
        ) : (
          <Document
            file={pdfDataUrl}
            onLoadSuccess={({ numPages: count }) => setNumPages(count)}
            className="animate-[fade-in_300ms_ease]"
          >
            {Array.from({ length: numPages }, (_, index) => (
              <Page
                key={index}
                pageNumber={index + 1}
                scale={zoom}
                className="mb-6 shadow-[0_1px_3px_rgba(43,38,32,0.25)] last:mb-0"
              />
            ))}
          </Document>
        )}
      </div>
    </div>
  );
}
