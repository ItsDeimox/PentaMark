const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pentaMarkDesktop", {
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
});
