const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const { existsSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const { get } = require("node:http");
const { basename, dirname, join, resolve } = require("node:path");

let serverProcess = null;
let mainWindow = null;
let activeVaultPath = "";
let activeVaultIsCustom = false;

function appRoot() {
  return app.isPackaged ? process.resourcesPath : resolve(__dirname, "..");
}

function dataRoot() {
  if (process.env.PENTAMARK_DATA_DIR) return resolve(process.env.PENTAMARK_DATA_DIR);
  const portableDirectory = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDirectory) return resolve(portableDirectory);
  const executableDirectory = dirname(process.execPath);
  if (existsSync(join(executableDirectory, "vault")) || existsSync(join(executableDirectory, "pentamark.config.json"))) return executableDirectory;
  return app.getPath("userData");
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
      PENTAMARK_DATA_DIR: directory,
      ...(customVault ? { PENTAMARK_VAULT_DIR: vaultDirectory } : {}),
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout?.on("data", (chunk) => console.log(String(chunk).trimEnd()));
  serverProcess.stderr?.on("data", (chunk) => console.error(String(chunk).trimEnd()));
}

async function createWindow() {
  const directory = dataRoot();
  const selectedVault = savedVaultDirectory();
  activeVaultIsCustom = Boolean(selectedVault);
  activeVaultPath = selectedVault || defaultVaultDirectory();
  const port = configuredPort(directory);
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
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

app.setName("PentaMark");
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
ipcMain.handle("pentamark:show-item", async (event, kind, relativePath) => {
  try {
    if (!rendererIsLocal(event)) return { ok: false, error: "Disponível apenas no cofre local do host" };
    if (kind !== "note" && kind !== "folder" && kind !== "asset") return { ok: false, error: "Tipo de item inválido" };
    const normalized = String(relativePath || "").replaceAll("\\", "/").replace(/^\/+/, "");
    if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) return { ok: false, error: "Caminho inválido" };
    const itemDirectory = resolve(kind === "asset" ? activeVaultPath : activeNotesDirectory());
    const target = resolve(itemDirectory, normalized);
    if (!target.startsWith(`${itemDirectory}\\`) && !target.startsWith(`${itemDirectory}/`)) return { ok: false, error: "Caminho inválido" };
    if (!existsSync(target)) return { ok: false, error: "O item não existe mais" };
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
app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});
app.whenReady().then(createWindow).catch((error) => {
  dialog.showErrorBox("PentaMark não iniciou", error instanceof Error ? error.message : String(error));
  app.quit();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  if (serverProcess && serverProcess.exitCode === null) serverProcess.kill();
});
