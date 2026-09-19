// Module-level side effects that must run before any Monaco editor mounts.
//
// 1. `@monaco-editor/react` defaults to fetching Monaco from
//    https://cdn.jsdelivr.net at runtime. The backend serves the app with
//    `Content-Security-Policy: default-src 'self'`, which blocks that request
//    outright, so the editor would never initialize in a real deployment.
//    `loader.config({ monaco })` points it at the locally installed, version
//    pinned `monaco-editor` package instead — no network access required.
//
// 2. Monaco (and monaco-yaml in particular) needs web workers. Vite's
//    `?worker` import suffix bundles each worker as its own local chunk.
//
// NOTE ON THE monaco-editor VERSION PIN (0.52.2): monaco-yaml 5.5.1 talks to
// its worker through monaco-worker-manager, which calls
// `monaco.editor.createWebWorker({ moduleId, createData })`. Monaco dropped
// that signature in 0.53 in favour of `{ worker, host }`, so on 0.53+ the YAML
// worker never receives its schema configuration and every request fails with
// "Missing requestHandler or method: doValidation". 0.52.2 is the last release
// with the API monaco-yaml still requires; do not bump it without checking that
// monaco-yaml has been updated for the new worker API.
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

import EditorWorker from "../workers/editor.worker?worker";
import YamlWorker from "../workers/yaml.worker?worker";

// `MonacoEnvironment` is declared on Window by monaco-editor's own typings.
self.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string): Worker {
    if (label === "yaml") {
      return new YamlWorker();
    }
    return new EditorWorker();
  },
};

loader.config({ monaco });

export { monaco };
