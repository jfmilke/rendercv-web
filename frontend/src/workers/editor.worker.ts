// Vite `?worker` entry point for Monaco's base editor worker. Bundled locally
// so nothing is fetched from a CDN at runtime (our CSP is `default-src 'self'`).
import "monaco-editor/esm/vs/editor/editor.worker.js";
