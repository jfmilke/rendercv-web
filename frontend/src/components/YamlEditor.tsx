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
      theme="vs-dark"
      value={value}
      onChange={(newValue) => onChange(newValue ?? "")}
      onMount={handleMount}
      options={{ minimap: { enabled: false }, fontSize: 13 }}
    />
  );
}
