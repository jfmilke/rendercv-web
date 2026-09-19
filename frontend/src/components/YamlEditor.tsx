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
