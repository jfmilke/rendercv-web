// Side-effect import: points @monaco-editor/react at the locally bundled
// monaco-editor (instead of a CSP-blocked CDN) and registers the web workers
// monaco-yaml needs. Must be imported before the editor mounts.
import "../lib/monacoSetup";
import Editor, { OnMount } from "@monaco-editor/react";
import { configureMonacoYaml } from "monaco-yaml";
import type * as MonacoNS from "monaco-editor";
import schema from "../schema/rendercv-schema.json";

interface YamlEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function YamlEditor({ value, onChange }: YamlEditorProps) {
  const handleMount: OnMount = (_editor, monaco) => {
    // A quiet paper-and-ink theme so the editor reads as a page in the
    // spread, not a stock code-editor dropped on top of it.
    monaco.editor.defineTheme("manuscript", {
      base: "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: "9c9080", fontStyle: "italic" },
        { token: "type", foreground: "274b6b" },
        { token: "string", foreground: "5f7350" },
        { token: "number", foreground: "9c3b2e" },
        { token: "keyword", foreground: "274b6b" },
      ],
      colors: {
        "editor.background": "#f4ecdc",
        "editor.foreground": "#2b2620",
        "editor.lineHighlightBackground": "#e9dfc7",
        "editor.lineHighlightBorder": "#00000000",
        "editorLineNumber.foreground": "#c2b393",
        "editorLineNumber.activeForeground": "#5b5346",
        "editorCursor.foreground": "#274b6b",
        "editorIndentGuide.background": "#e0d3b4",
        "editor.selectionBackground": "#d9cbb0",
        "editorWidget.background": "#fffaf0",
        "editorWidget.border": "#ddcfb2",
        "editorSuggestWidget.background": "#fffaf0",
        "scrollbarSlider.background": "#ddcfb280",
        "scrollbarSlider.hoverBackground": "#ddcfb2c0",
      },
    });
    configureMonacoYaml(monaco as unknown as typeof MonacoNS, {
      enableSchemaRequest: false,
      schemas: [
        {
          uri: "https://rendercv-web.local/schema.json",
          fileMatch: ["*"],
          schema,
        },
      ],
    });
  };

  return (
    <Editor
      height="100%"
      defaultLanguage="yaml"
      theme="manuscript"
      value={value}
      onChange={(newValue) => onChange(newValue ?? "")}
      onMount={handleMount}
      options={{ minimap: { enabled: false }, fontSize: 13, padding: { top: 16 } }}
    />
  );
}
