const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pentaMarkDesktop", {
  sync: { invoke: command => ipcRenderer.invoke('pentamark:sync', command) },
  tailscaleStatus:()=>ipcRenderer.invoke('pentamark:tailscale-status'),
  saveTailscaleKey:key=>ipcRenderer.invoke('pentamark:tailscale-save-key',key),
  forgetTailscaleKey:()=>ipcRenderer.invoke('pentamark:tailscale-forget-key'),
  createTailscaleInvite:()=>ipcRenderer.invoke('pentamark:tailscale-invite'),
  openTailscaleSetup:step=>ipcRenderer.invoke('pentamark:tailscale-setup',step),
  consumeInvitation:()=>ipcRenderer.invoke('pentamark:invitation-consume'),
  openTailscaleInvite:url=>ipcRenderer.invoke('pentamark:invitation-open',url),
  onInvitation:listener=>{const receive=(_event,url)=>listener(url);ipcRenderer.on('pentamark:invitation',receive);return()=>ipcRenderer.removeListener('pentamark:invitation',receive);},
  getUpdateStatus:()=>ipcRenderer.invoke('pentamark:update-status'),
  checkForUpdates:()=>ipcRenderer.invoke('pentamark:update-check'),
  downloadUpdate:()=>ipcRenderer.invoke('pentamark:update-download'),
  installUpdate:()=>ipcRenderer.invoke('pentamark:update-install'),
  getProfile() {
    return ipcRenderer.invoke("pentamark:get-profile");
  },
  setProfile(profile) {
    return ipcRenderer.invoke("pentamark:set-profile", profile);
  },
  getVault() {
    return ipcRenderer.invoke("pentamark:get-vault");
  },
  chooseVault() {
    return ipcRenderer.invoke("pentamark:choose-vault");
  },
  showVault() {
    return ipcRenderer.invoke("pentamark:show-vault");
  },
  openInFolder(kind, path) {
    return ipcRenderer.invoke("pentamark:show-item", kind, path);
  },
  resolveItemPath(kind, path) {
    return ipcRenderer.invoke("pentamark:resolve-item-path", kind, path);
  },
});
