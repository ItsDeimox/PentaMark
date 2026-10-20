import { ConfirmationProvider } from "./components/dialogs/Confirmation";
import React from "react";
import { createRoot } from "react-dom/client";
import PentaMarkApp from "./PentaMarkApp";
import "./base.css";
import "./app.css";
import "./features/markdown/obsidian.css";
import "./features/editor/workspace.css";
import "./features/markdown/document.css";
import "@fontsource/chakra-petch/latin-400.css";
import "@fontsource/chakra-petch/latin-400-italic.css";
import "@fontsource/chakra-petch/latin-500.css";
import "@fontsource/chakra-petch/latin-600.css";
import "@fontsource/chakra-petch/latin-700.css";
import "./features/workspace/chrome.css";
import "./components/dialogs/dialogs.css";
import "./features/workspace/glass-polish.css";
import "./features/workspace/visual-polish.css";
import "./features/workspace/finish-polish.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfirmationProvider><PentaMarkApp /></ConfirmationProvider>
  </React.StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}
