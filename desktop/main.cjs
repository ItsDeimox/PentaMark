const { app, BrowserWindow, dialog, ipcMain, shell, safeStorage } = require("electron");
const { createTailscaleSharing } = require('./tailscale.cjs');
const { createUpdater } = require('./updater.cjs');
const { invitationFromArgs, validInviteUrl } = require('./invitations.cjs');
const { createSyncBridge } = require('./sync-ipc.cjs');
const { spawn } = require("node:child_process");
const { existsSync, readFileSync, statSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync } = require("node:fs");
const { randomBytes } = require("node:crypto");
const { get } = require("node:http");
const { basename, dirname, join, resolve } = require("node:path");

let serverProcess = null;
let mainWindow = null;
let splashWindow = null;
let activeVaultPath = "";
let activeVaultIsCustom = false;
let localOrigin = '';
let pendingInvitation=invitationFromArgs(process.argv);
let sharing=null, updater=null;
let resolvedDataRoot = '';

function trustedFrame(event) {
  return Boolean(mainWindow && event.sender===mainWindow.webContents && event.senderFrame===mainWindow.webContents.mainFrame && localOrigin && new URL(event.senderFrame.url).origin===localOrigin);
}
function localHandle(channel,handler){ipcMain.handle(channel,async(event,...args)=>{if(!trustedFrame(event))throw new Error('Disponível somente no PentaMark deste PC.');return handler(...args);});}
function deliverInvitation(args) {
  const value=invitationFromArgs(args);if(!value)return;
  pendingInvitation=value;
  if(mainWindow&&!mainWindow.webContents.isLoading()&&mainWindow.webContents.getURL().startsWith(localOrigin+'/')){
    // Keep it until the renderer consumes it: the document can be loaded before
    // React has installed its listener.
    mainWindow.webContents.send('pentamark:invitation',value);
  }
}

function appRoot() {
  return app.isPackaged ? process.resourcesPath : resolve(__dirname, "..");
}

function canWriteDataDirectory(directory) {
  let probe = '';
  try {
    mkdirSync(directory, { recursive: true });
    probe = join(directory, `.pentamark-write-${process.pid}-${randomBytes(8).toString('hex')}`);
    const descriptor = openSync(probe, 'wx');
    closeSync(descriptor);
    unlinkSync(probe);
    probe = '';
    return true;
  } catch {
    return false;
  } finally {
    if (probe) { try { unlinkSync(probe); } catch { /* Preserve the original failure. */ } }
  }
}

function dataRoot() {
  if (resolvedDataRoot) return resolvedDataRoot;
  if (process.env.PENTAMARK_DATA_DIR) {
    const explicit = resolve(process.env.PENTAMARK_DATA_DIR);
    if (!canWriteDataDirectory(explicit)) throw new Error(`Sem permissão para gravar os dados do PentaMark em: ${explicit}`);
    return resolvedDataRoot = explicit;
  }
  const portableDirectory = process.env.PORTABLE_EXECUTABLE_DIR;
  const executableDirectory = dirname(process.execPath);
  const candidate = portableDirectory ? resolve(portableDirectory) : executableDirectory;
  const hasVault = existsSync(join(candidate, 'vault'));
  const hasConfig = existsSync(join(candidate, 'pentamark.config.json'));
  if (portableDirectory || hasVault || hasConfig) {
    if (canWriteDataDirectory(candidate)) return resolvedDataRoot = candidate;
    // Never silently abandon a real portable vault in favour of an empty one.
    if (hasVault) throw new Error(`Sem permissão para gravar o cofre em: ${candidate}. Mova o aplicativo e seu cofre para uma pasta do usuário.`);
  }
  const userDirectory = app.getPath('userData');
  if (!canWriteDataDirectory(userDirectory)) throw new Error(`Sem permissão para gravar os dados do PentaMark em: ${userDirectory}`);
  return resolvedDataRoot = userDirectory;
}

// An explicitly isolated profile must be selected before reading settings or
// acquiring the single-instance lock. Native validation uses a disposable one.
if (process.env.PENTAMARK_USER_DATA_DIR) {
  const profileDirectory = resolve(process.env.PENTAMARK_USER_DATA_DIR);
  if (!canWriteDataDirectory(profileDirectory)) throw new Error(`Sem permissão para gravar o perfil do PentaMark em: ${profileDirectory}`);
  app.setPath('userData', profileDirectory);
}

function defaultVaultDirectory() {
  return join(dataRoot(), "vault");
}

function desktopSettingsPath() {
  return join(app.getPath("userData"), "pentamark.desktop.json");
}

function savedVaultDirectory() {
  try {
    const settings = JSON.parse(readFileSync(desktopSettingsPath(), "utf8"));
    const storedPath = String(settings.vaultPath || "").trim();
    if (!storedPath) return "";
    const candidate = resolve(storedPath);
    if (candidate && existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
  } catch {
    // O cofre padrão continua disponível se a pasta escolhida sumir.
  }
  return "";
}

function rendererIsLocal(event) {
  try {
    const page = new URL(event.senderFrame.url);
    return page.hostname === "127.0.0.1" || page.hostname === "localhost";
  } catch {
    return false;
  }
}

function activeNotesDirectory() {
  return activeVaultIsCustom ? activeVaultPath : join(activeVaultPath, "notes");
}

function configuredPort(directory) {
  try {
    const config = JSON.parse(readFileSync(join(directory, "pentamark.config.json"), "utf8"));
    const port = Number(config.port);
    return port >= 1024 && port <= 65535 ? port : 3417;
  } catch {
    return 3417;
  }
}

function waitForServer(port, timeoutMs = 15_000) {
  const started = Date.now();
  return new Promise((resolveReady, reject) => {
    const attempt = () => {
      if (serverProcess?.exitCode !== null) {
        reject(new Error("O servidor local encerrou antes de abrir a interface."));
        return;
      }
      const request = get(`http://127.0.0.1:${port}/api/state`, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          try {
            const state = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (response.statusCode === 200 && state.app === "PentaMark") resolveReady();
            else retry();
          } catch {
            retry();
          }
        });
      });
      request.setTimeout(700, () => request.destroy());
      request.on("error", retry);
    };
    const retry = () => {
      if (Date.now() - started >= timeoutMs) reject(new Error("O PentaMark demorou demais para iniciar."));
      else setTimeout(attempt, 180);
    };
    attempt();
  });
}

function startServer(directory, vaultDirectory, customVault) {
  const serverPath = join(appRoot(), "local", "server.mjs");
  serverProcess = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PENTAMARK_DESKTOP: "1",
      PENTAMARK_USER_DATA_DIR: app.getPath('userData'),
      PENTAMARK_DATA_DIR: directory,
      ...(customVault ? { PENTAMARK_VAULT_DIR: vaultDirectory } : {}),
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  serverProcess.stdout?.on("data", (chunk) => console.log(String(chunk).trimEnd()));
  serverProcess.stderr?.on("data", (chunk) => console.error(String(chunk).trimEnd()));
}

const syncBridge = createSyncBridge({ getChild: () => serverProcess, trustedFrame,
  validationPath: join(appRoot(), 'local', 'sync', 'replica-validation.mjs'),
  pickImportFile: async () => { const result = await dialog.showOpenDialog(mainWindow, { title: 'Importar arquivo na cópia offline', properties: ['openFile'] }); return result.canceled ? null : result.filePaths[0]; },
  pickExportFile: async () => { const result = await dialog.showSaveDialog(mainWindow, { title: 'Exportar versão preservada', defaultPath: 'PentaMark-version', properties: ['showOverwriteConfirmation'] }); return result.canceled ? null : result.filePath; },
  pickExportDirectory: async () => { const result = await dialog.showOpenDialog(mainWindow, { title: 'Exportar réplica completa para uma pasta', properties: ['openDirectory', 'createDirectory'] }); return result.canceled ? null : result.filePaths[0]; },
});
ipcMain.handle('pentamark:sync', (event, command) => syncBridge.invoke(event, command));
app.on('will-quit', () => syncBridge.close());

async function createWindow() {
  splashWindow = new BrowserWindow({
    width: 460, height: 320, frame: false, resizable: false, show: false,
    backgroundColor: "#090c0f", title: "Abrindo PentaMark",
    icon: join(appRoot(), "local-dist", "pentamark-window-icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  splashWindow.once("ready-to-show", () => splashWindow?.show());
  splashWindow.on("closed", () => { splashWindow = null; });
  await splashWindow.loadFile(join(__dirname, "splash.html"));
  const directory = dataRoot();
  const selectedVault = savedVaultDirectory();
  activeVaultIsCustom = Boolean(selectedVault);
  activeVaultPath = selectedVault || defaultVaultDirectory();
  const port = configuredPort(directory);
  localOrigin=`http://127.0.0.1:${port}`;
  sharing=createTailscaleSharing({app,safeStorage,shell,getPort:()=>port});
  updater=createUpdater({app,dataRoot,stopServer:async()=>{
    if(!serverProcess||serverProcess.exitCode!==null)return;
    const child=serverProcess;
    await new Promise(resolveStop=>{const timer=setTimeout(resolveStop,3000);child.once('exit',()=>{clearTimeout(timer);resolveStop();});child.kill();});
  }});
  startServer(directory, activeVaultPath, activeVaultIsCustom);
  await waitForServer(port);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 920,
    minHeight: 620,
    show: false,
    backgroundColor: "#090c0f",
    title: "PentaMark",
    icon: join(appRoot(), "local-dist", "pentamark-window-icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    splashWindow?.destroy();
  });
  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

app.setName("PentaMark");
localHandle('pentamark:tailscale-status',()=>sharing.status());
localHandle('pentamark:tailscale-save-key',key=>sharing.saveKey(key));
localHandle('pentamark:tailscale-forget-key',()=>sharing.forgetKey());
localHandle('pentamark:tailscale-invite',()=>sharing.createInvite());
localHandle('pentamark:tailscale-setup',step=>sharing.openSetup(step));
localHandle('pentamark:invitation-consume',()=>{const value=pendingInvitation;pendingInvitation=null;return value;});
localHandle('pentamark:invitation-open',async url=>{if(!validInviteUrl(url))throw new Error('Convite inválido.');await shell.openExternal(url);});
localHandle('pentamark:update-status',()=>updater.getStatus());
localHandle('pentamark:update-check',()=>updater.check());
localHandle('pentamark:update-download',()=>updater.download());
localHandle('pentamark:update-install',()=>updater.install());
ipcMain.handle("pentamark:get-profile", () => {
  try {
    const profile = JSON.parse(readFileSync(join(dataRoot(), "pentamark.profile.json"), "utf8"));
    return { name: String(profile.name || "").slice(0, 60), avatar: String(profile.avatar || "").slice(0, 150_000) };
  } catch {
    return { name: "", avatar: "" };
  }
});
ipcMain.handle("pentamark:set-profile", (_event, profile) => {
  try {
    const name = String(profile?.name || "").trim().replace(/[\r\n\t]/g, " ").slice(0, 60);
    const avatarValue = String(profile?.avatar || "");
    const avatar = /^data:image\/(?:png|jpeg|webp);base64,/i.test(avatarValue) && avatarValue.length <= 150_000 ? avatarValue : "";
    writeFileSync(join(dataRoot(), "pentamark.profile.json"), `${JSON.stringify({ name, avatar }, null, 2)}\n`, "utf8");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
ipcMain.handle("pentamark:get-vault", (event) => {
  if (!rendererIsLocal(event)) return { ok: false, error: "Disponível apenas no host" };
  return { ok: true, path: activeVaultPath, name: basename(activeVaultPath), custom: activeVaultIsCustom };
});
ipcMain.handle("pentamark:choose-vault", async (event) => {
  try {
    if (!rendererIsLocal(event)) return { ok: false, error: "Disponível apenas no host" };
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: "Abrir cofre do PentaMark",
      defaultPath: activeVaultPath,
      buttonLabel: "Abrir este cofre",
      properties: ["openDirectory", "createDirectory"],
    });
    if (selected.canceled || !selected.filePaths[0]) return { ok: true, canceled: true };
    const chosen = resolve(selected.filePaths[0]);
    const useDefaultLayout = chosen === resolve(defaultVaultDirectory());
    writeFileSync(desktopSettingsPath(), `${JSON.stringify({ vaultPath: useDefaultLayout ? "" : chosen }, null, 2)}\n`, "utf8");
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 220);
    return { ok: true, path: chosen, restarting: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
ipcMain.handle("pentamark:show-vault", async (event) => {
  try {
    if (!rendererIsLocal(event)) return { ok: false, error: "Disponível apenas no host" };
    const error = await shell.openPath(activeVaultPath);
    return error ? { ok: false, error } : { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
function validatedVaultItem(kind, relativePath) {
  if (kind !== "note" && kind !== "folder" && kind !== "asset") throw new Error("Tipo de item inválido");
  const normalized = String(relativePath || "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Caminho inválido");
  const directory = resolve(kind === "asset" ? activeVaultPath : activeNotesDirectory());
  const absolute = resolve(directory, normalized);
  if (!absolute.startsWith(`${directory}\\`) && !absolute.startsWith(`${directory}/`)) throw new Error("Caminho inválido");
  if (!existsSync(absolute)) throw new Error("O item não existe mais");
  const relative = activeVaultIsCustom || kind === "asset" ? normalized : `notes/${normalized}`;
  return { absolute, relative };
}
ipcMain.handle("pentamark:resolve-item-path", (event, kind, relativePath) => {
  try {
    if (!rendererIsLocal(event)) return {ok:false,error:"Disponível apenas no Desktop local"};
    const {absolute,relative} = validatedVaultItem(kind,relativePath);
    return {ok:true,absolute,relative};
  } catch(error) {return {ok:false,error:error instanceof Error ? error.message : String(error)};}
});
ipcMain.handle("pentamark:show-item", async (event, kind, relativePath) => {
  try {
    if (!rendererIsLocal(event)) return { ok: false, error: "Disponível apenas no cofre local do host" };
    const {absolute: target} = validatedVaultItem(kind, relativePath);
    if (kind === "folder") {
      const error = await shell.openPath(target);
      return error ? { ok: false, error } : { ok: true };
    }
    shell.showItemInFolder(target);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
app.on("second-instance", (_event,argv) => {
  deliverInvitation(argv);
  if (!mainWindow) { splashWindow?.focus(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});
app.on('open-url',(event,url)=>{event.preventDefault();deliverInvitation([url]);});
if(app.isPackaged&&process.platform==='win32') app.setAsDefaultProtocolClient('pentamark',process.env.PORTABLE_EXECUTABLE_FILE||process.execPath);
if (hasSingleInstanceLock) app.whenReady().then(createWindow).catch((error) => {
  splashWindow?.destroy();
  dialog.showErrorBox("PentaMark não iniciou", error instanceof Error ? error.message : String(error));
  app.quit();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  if (serverProcess && serverProcess.exitCode === null) serverProcess.kill();
});
