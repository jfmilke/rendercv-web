import type { ChangeEvent } from "react";

interface ToolbarProps {
  onUploadYaml: (content: string) => void;
  onDownloadYaml: () => void;
  onDownloadPdf: () => void;
  onGenerate: () => void;
  isGenerating: boolean;
  hasPdf: boolean;
}

export function Toolbar({
  onUploadYaml,
  onDownloadYaml,
  onDownloadPdf,
  onGenerate,
  isGenerating,
  hasPdf,
}: ToolbarProps) {
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onUploadYaml(String(reader.result));
    reader.readAsText(file);
    event.target.value = "";
  }

  return (
    <div className="flex items-center gap-3 rounded-xl bg-panel-bg p-3">
      <label className="cursor-pointer rounded-lg bg-field-bg px-3 py-2 text-sm">
        Upload YAML
        <input type="file" accept=".yaml,.yml" className="hidden" onChange={handleFileChange} />
      </label>
      <button className="rounded-lg bg-field-bg px-3 py-2 text-sm" onClick={onDownloadYaml}>
        Download YAML
      </button>
      <button
        className="rounded-lg bg-field-bg px-3 py-2 text-sm disabled:opacity-40"
        onClick={onDownloadPdf}
        disabled={!hasPdf}
      >
        Download PDF
      </button>
      <button
        className="ml-auto rounded-lg bg-accent px-4 py-2 text-sm font-semibold disabled:opacity-40"
        onClick={onGenerate}
        disabled={isGenerating}
      >
        {isGenerating ? "Generating..." : "Generate PDF"}
      </button>
    </div>
  );
}
