import { useEffect, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { GenerateControls } from "./components/GenerateControls";
import { YamlEditor } from "./components/YamlEditor";
import { PdfPreview } from "./components/PdfPreview";
import { OutputLog } from "./components/OutputLog";
import { VersionBadge } from "./components/VersionBadge";
import { ImageUpload } from "./components/ImageUpload";
import { fetchConfig, streamRender } from "./lib/api";
import { getOrCreateSessionId } from "./lib/session";
import { isErrorLine } from "./lib/logLines";
import DEFAULT_YAML from "./assets/john-doe-classic-theme-cv.yaml?raw";

const YAML_STORAGE_KEY = "rendercv-web-yaml-draft";

function App() {
  const [sessionId] = useState(getOrCreateSessionId);
  const [yamlContent, setYamlContent] = useState(
    () => localStorage.getItem(YAML_STORAGE_KEY) ?? DEFAULT_YAML
  );
  const [logLines, setLogLines] = useState<string[]>([]);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [pdfDataUrl, setPdfDataUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [imageUploadEnabled, setImageUploadEnabled] = useState(false);
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "rendercv-web-spread",
    storage: window.localStorage,
  });

  useEffect(() => {
    fetchConfig()
      .then((config) => setImageUploadEnabled(config.imageUploadEnabled))
      .catch(() => setImageUploadEnabled(false));
  }, []);

  function updateYaml(content: string) {
    setYamlContent(content);
    localStorage.setItem(YAML_STORAGE_KEY, content);
  }

  function appendLogLine(line: string) {
    setLogLines((lines) => [...lines, line]);
    if (isErrorLine(line)) {
      setIsLogOpen(true);
    }
  }

  async function handleGenerate() {
    setIsGenerating(true);
    setLogLines([]);
    try {
      for await (const event of streamRender(yamlContent, sessionId)) {
        if (event.type === "log") {
          appendLogLine(event.line);
        } else if (event.status === "success") {
          setPdfDataUrl(`data:application/pdf;base64,${event.pdfBase64}`);
        } else {
          appendLogLine(`Error: ${event.message}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLogLine(`Error: ${message}`);
    } finally {
      // Always clear the flag, otherwise the UI stays stuck on "Generating...".
      setIsGenerating(false);
    }
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
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-rule bg-surface px-5 py-3">
        <h1 className="font-serif text-lg font-medium tracking-wide text-ink">Rendercv Web</h1>
        <VersionBadge />
      </header>
      <Group
        orientation="horizontal"
        id="editor-preview-spread"
        className="min-h-0 flex-1"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
      >
        <Panel id="yaml" defaultSize="50" minSize="20" className="h-full min-h-0 overflow-hidden">
          <YamlEditor value={yamlContent} onChange={updateYaml} />
        </Panel>
        <Separator className="book-spine" />
        <Panel id="pdf" defaultSize="50" minSize="20" className="h-full min-h-0 overflow-hidden">
          <PdfPreview pdfDataUrl={pdfDataUrl} />
        </Panel>
      </Group>
      <div className="flex flex-wrap items-center gap-3 border-t border-rule bg-surface px-5 py-2.5">
        {imageUploadEnabled && <ImageUpload sessionId={sessionId} />}
        <GenerateControls
          onDownloadPdf={handleDownloadPdf}
          onGenerate={handleGenerate}
          isGenerating={isGenerating}
          hasPdf={pdfDataUrl !== null}
        />
      </div>
      <OutputLog lines={logLines} isOpen={isLogOpen} onToggle={() => setIsLogOpen((open) => !open)} />
    </div>
  );
}

export default App;
