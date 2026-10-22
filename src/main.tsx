import { ConfirmationProvider } from "./components/dialogs/Confirmation";
import React from "react";
import { initializeAndroid, isAndroidLocal, isRemoteVault, returnToAndroidLocal } from './platform/android';
import { initializeReplica, isOfflineReplica, exportReplicaRecovery } from './platform/replica';
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
await initializeReplica();
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
  if(isOfflineReplica&&String(error instanceof Error?error.message:error).includes('unsupported-schema')){
    const explanation=document.createElement('p');
    explanation.textContent='Esta cópia foi gravada por uma versão incompatível. Não limpe os dados nem desinstale. É possível exportar os arquivos sem convertê-los; a recuperação exige uma versão compatível.';
    const recovery=document.createElement('button');recovery.textContent='Exportar cópia para recuperação';
    const status=document.createElement('p');status.setAttribute('role','status');
    recovery.onclick=async()=>{
      recovery.disabled=true;retry.disabled=true;status.textContent='Preparando cópia de recuperação…';
      try{const result=await exportReplicaRecovery();status.textContent=result.cancelled?'Exportação cancelada; dados originais mantidos.':'Cópia exportada sem conversão. Use uma versão compatível para recuperar os dados.';}
      catch(failure){status.textContent=`Não foi possível concluir a exportação: ${failure instanceof Error?failure.message:String(failure)}. Os dados originais foram mantidos.`;}
      finally{recovery.disabled=false;retry.disabled=false;}
    };
    root.append(explanation,recovery,status);
  }
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
