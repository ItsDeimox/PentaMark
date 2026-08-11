import React from "react";
import { createRoot } from "react-dom/client";
import PentaMarkApp from "./PentaMarkApp";
import "./base.css";
import "./app.css";
import "./features/markdown/obsidian.css";
import "./features/editor/workspace.css";
import "./features/markdown/document.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PentaMarkApp />
  </React.StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}
