import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { THEME_STORAGE_KEY } from "./lib/theme";
import "./index.css";

// Applied before the first paint so loading (or switching back to) light
// mode doesn't flash the default dark theme first. Dark is the default;
// light only applies once someone has explicitly chosen it.
if (localStorage.getItem(THEME_STORAGE_KEY) !== "light") {
  document.documentElement.dataset.theme = "dark";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
