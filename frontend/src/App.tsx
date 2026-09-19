import { useEffect, useState } from "react";
import { Toolbar } from "./components/Toolbar";
import { YamlEditor } from "./components/YamlEditor";
import { PdfPreview } from "./components/PdfPreview";
import { OutputLog } from "./components/OutputLog";
import { VersionBadge } from "./components/VersionBadge";
import { ImageUpload } from "./components/ImageUpload";
import { fetchConfig, streamRender } from "./lib/api";
import { getOrCreateSessionId } from "./lib/session";

const YAML_STORAGE_KEY = "rendercv-web-yaml-draft";
const DEFAULT_YAML = "cv:\n  name: Your Name\n  sections:\n    experience: []\n";

function App() {
  const [sessionId] = useState(getOrCreateSessionId);
  const [yamlContent, setYamlContent] = useState(
    () => localStorage.getItem(YAML_STORAGE_KEY) ?? DEFAULT_YAML
  );
  const [logLines, setLogLines] = useState<string[]>([]);
  const [pdfDataUrl, setPdfDataUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [imageUploadEnabled, setImageUploadEnabled] = useState(false);

  useEffect(() => {
    fetchConfig()
      .then((config) => setImageUploadEnabled(config.imageUploadEnabled))
      .catch(() => setImageUploadEnabled(false));
  }, []);

  function updateYaml(content: string) {
    setYamlContent(content);
    localStorage.setItem(YAML_STORAGE_KEY, content);
  }

  async function handleGenerate() {
    setIsGenerating(true);
    setLogLines([]);
    try {
      for await (const event of streamRender(yamlContent, sessionId)) {
        if (event.type === "log") {
          setLogLines((lines) => [...lines, event.line]);
        } else if (event.status === "success") {
          setPdfDataUrl(`data:application/pdf;base64,${event.pdfBase64}`);
        } else {
          setLogLines((lines) => [...lines, `Error: ${event.message}`]);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLogLines((lines) => [...lines, `Error: ${message}`]);
    } finally {
      // Always clear the flag, otherwise the UI stays stuck on "Generating...".
      setIsGenerating(false);
    }
  }

  function handleDownloadYaml() {
    const blob = new Blob([yamlContent], { type: "application/yaml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "cv.yaml";
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleDownloadPdf() {
    if (!pdfDataUrl) {
      return;
    }
    const link = document.createElement("a");
    link.href = pdfDataUrl;
    link.download = "cv.pdf";
    link.click();
  }

  return (
    <div className="flex h-screen flex-col gap-3 p-3">
      <header className="flex items-center justify-between rounded-xl bg-panel-bg px-4 py-2">
        <h1 className="text-lg font-semibold">RenderCV Web</h1>
        <VersionBadge />
      </header>
      <Toolbar
        onUploadYaml={updateYaml}
        onDownloadYaml={handleDownloadYaml}
        onDownloadPdf={handleDownloadPdf}
        onGenerate={handleGenerate}
        isGenerating={isGenerating}
        hasPdf={pdfDataUrl !== null}
      />
      <div className="grid flex-1 grid-cols-2 gap-3 overflow-hidden">
        <YamlEditor value={yamlContent} onChange={updateYaml} />
        <PdfPreview pdfDataUrl={pdfDataUrl} />
      </div>
      {imageUploadEnabled && <ImageUpload sessionId={sessionId} />}
      <OutputLog lines={logLines} />
    </div>
  );
}

export default App;
