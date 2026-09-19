// Vite `?worker` entry point for monaco-yaml's language worker. monaco-yaml
// does nothing without this worker registered (see its README: "Is the web
// worker necessary? Yes."), and its own docs recommend re-exporting it from a
// project-local file like this one when bundling with Vite.
import "monaco-yaml/yaml.worker.js";
