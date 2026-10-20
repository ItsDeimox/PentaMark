import { ConfirmationProvider } from "./components/dialogs/Confirmation";
import React from "react";
import { initializeAndroid, isAndroidLocal, isRemoteVault, returnToAndroidLocal } from './platform/android';
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
import "./features/workspace/optical-glass.css";
import "./features/workspace/theme-controls.css";

async function start() {
await initializeAndroid();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfirmationProvider><PentaMarkApp /></ConfirmationProvider>
  </React.StrictMode>,
);
}
void start().catch(error => {
  const root = document.getElementById('root')!;
  const message = document.createElement('p');
  message.textContent = `Não foi possível abrir ${isRemoteVault ? 'o PC conectado' : 'o cofre local'}: ${error instanceof Error ? error.message : String(error)}. Seus arquivos e rascunhos não foram apagados.`;
  const retry = document.createElement('button');
  retry.textContent = 'Tentar novamente';
  retry.onclick = () => location.reload();
  root.replaceChildren(message, retry);
  if (isRemoteVault) {
    const local = document.createElement('button');
    local.textContent = 'Usar arquivos locais';
    local.onclick = returnToAndroidLocal;
    root.append(local);
  }
});

if (!isAndroidLocal && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}
