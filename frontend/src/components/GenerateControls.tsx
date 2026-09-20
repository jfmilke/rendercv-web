interface GenerateControlsProps {
  onDownloadPdf: () => void;
  onGenerate: () => void;
  isGenerating: boolean;
  hasPdf: boolean;
}

const buttonClass =
  "rounded-sm border border-rule bg-page px-3 py-1.5 font-serif text-sm text-ink-soft " +
  "transition-colors duration-150 hover:border-accent hover:text-accent " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
  "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-rule disabled:hover:text-ink-soft";

export function GenerateControls({
  onDownloadPdf,
  onGenerate,
  isGenerating,
  hasPdf,
}: GenerateControlsProps) {
  return (
    <div className="ml-auto flex items-center gap-2">
      <button className={buttonClass} onClick={onDownloadPdf} disabled={!hasPdf}>
        Download PDF
      </button>
      <button
        className={`rounded-sm bg-accent px-4 py-1.5 font-serif text-sm font-medium text-surface
          transition-[background-color,box-shadow] duration-150 hover:bg-accent-soft
          focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
          disabled:cursor-not-allowed ${isGenerating ? "animate-lamp-glow" : "disabled:opacity-60"}`}
        onClick={onGenerate}
        disabled={isGenerating}
      >
        {isGenerating ? "Generating..." : "Generate PDF"}
      </button>
    </div>
  );
}
