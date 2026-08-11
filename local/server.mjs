import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, copyFile, mkdir, readFile, readdir, realpath, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { handleMcpRequest } from "./mcp-bridge.mjs";

const LOCAL_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(LOCAL_DIR, "..");
const DATA_DIR = process.env.PENTAMARK_DATA_DIR ? resolve(process.env.PENTAMARK_DATA_DIR) : APP_DIR;
const DIST_DIR = join(APP_DIR, "local-dist");
const CUSTOM_VAULT_DIR = process.env.PENTAMARK_VAULT_DIR ? resolve(process.env.PENTAMARK_VAULT_DIR) : "";
const VAULT_DIR = CUSTOM_VAULT_DIR || join(DATA_DIR, "vault");
const NOTES_DIR = CUSTOM_VAULT_DIR ? VAULT_DIR : join(VAULT_DIR, "notes");
const ASSETS_DIR = join(VAULT_DIR, "assets");
const HISTORY_DIR = join(VAULT_DIR, ".history");
const TRASH_DIR = join(VAULT_DIR, ".trash");
const CONFIG_PATH = join(DATA_DIR, "pentamark.config.json");

const DEFAULT_CONFIG = {
  vaultName: "PentaMark",
  port: 3417,
  bind: "0.0.0.0",
  openBrowser: true,
  maxUploadMB: 2048,
  lockEditedNotes: false,
  cleanupUnusedAssets: false,
  aiBridgeEnabled: false,
  aiBridgeToken: "",
  userPermissions: {},
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".ogv": "video/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".3gp": "audio/3gpp",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".md": "text/markdown; charset=utf-8",
};

const BOOTSTRAP_NOTES = {
  "00 — Comece aqui.md": `-# Bem-vindo ao PentaMark

> Um cofre Markdown compartilhado. Local, rápido e sem assinatura intergaláctica.

## Primeiros passos

1. Crie notas com o botão **Nova nota**.
2. Organize notas e pastas pela barra lateral.
3. Arraste imagens, vídeos ou arquivos direto para o editor.
4. Abra **Compartilhar** e envie o endereço para seus amigos.

Tudo é salvo automaticamente em arquivos Markdown reais. Para fazer backup, copie a pasta \`vault\` inteira.

## Atalhos

- \`Ctrl + N\` — nova nota
- \`Ctrl + P\` — buscar
- \`Ctrl + S\` — salvar agora
- \`Ctrl + B\` — ocultar ou mostrar os arquivos
`,
};

const LEGACY_WELCOME = `# Bem-vindo ao PentaMark

> O cofre compartilhado do **Pentagory**. Local, rápido e sem assinatura intergaláctica.

## Primeiros passos

1. Crie notas com o botão **Nova nota**.
2. Use caminhos como \`Vértice 0/Graybox.md\` para organizar em pastas.
3. Arraste imagens, vídeos ou arquivos direto para o editor.
4. Abra **Compartilhar** e mande o endereço do Radmin para seu amigo.

Tudo é salvo automaticamente em arquivos Markdown reais. Para fazer backup, copie a pasta \`vault\` inteira.

## Atalhos

- \`Ctrl + N\` — nova nota
- \`Ctrl + P\` — buscar
- \`Ctrl + S\` — salvar agora
- \`Ctrl + B\` — ocultar ou mostrar os arquivos
`;

const LEGACY_DEVLOG = `# DEVLOG

## 10/08/2026

- **[Ferramenta]** Criação do PentaMark
- **[Organização]** Cofre compartilhado do Pentagory
`;

let config = DEFAULT_CONFIG;
let runtimePort = DEFAULT_CONFIG.port;
const sseClients = new Map();
const noteLocks = new Map();
const mcpActivity = new Map();
let cleanupTimer = null;

const IMAGE_EXTENSIONS = new Set([".avif", ".bmp", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
const AUDIO_EXTENSIONS = new Set([".flac", ".m4a", ".mp3", ".ogg", ".wav", ".3gp"]);
const VIDEO_EXTENSIONS = new Set([".mkv", ".mov", ".mp4", ".ogv", ".webm"]);
const CLEANABLE_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS, ".pdf"]);
const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".csv", ".tsv", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".css", ".html", ".xml", ".svg", ".py", ".lua", ".c", ".h", ".cpp", ".hpp", ".cs", ".java", ".rs", ".go", ".glsl", ".gd"]);

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function errorJson(res, status, message) {
  json(res, status, { error: message });
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function revisionFor(content) {
  return createHash("sha256").update(content).digest("hex").slice(0, 20);
}

function cleanRelativePath(input, extensionRequired = false) {
  if (typeof input !== "string") throw new Error("Caminho inválido");
  const normalized = input.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) throw new Error("Caminho inválido");
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw new Error("Caminho inválido");
  if (segments.some((segment) => /[<>:"|?*]/.test(segment) || /[. ]$/.test(segment))) throw new Error("O nome contém caracteres inválidos no Windows");
  if (segments.some((segment) => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) throw new Error("Esse nome é reservado pelo Windows");
  if (extensionRequired && !normalized.toLowerCase().endsWith(".md")) throw new Error("A nota precisa terminar em .md");
  return normalized;
}

function noteTarget(input) {
  const path = cleanRelativePath(input, true);
  const fullPath = resolve(NOTES_DIR, path);
  if (!fullPath.startsWith(`${NOTES_DIR}${sep}`)) throw new Error("Caminho inválido");
  return { path, fullPath };
}

function folderTarget(input) {
  const path = cleanRelativePath(input, false);
  const fullPath = resolve(NOTES_DIR, path);
  if (!fullPath.startsWith(`${NOTES_DIR}${sep}`)) throw new Error("Caminho inválido");
  return { path, fullPath };
}

async function readJsonBody(req, maxBytes = 10 * 1024 * 1024) {
  const raw = await readRawBody(req, maxBytes);
  return raw.length ? JSON.parse(raw.toString("utf8")) : {};
}

async function readRawBody(req, maxBytes = 10 * 1024 * 1024) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error("Conteúdo grande demais");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function unescapeMarkdownPath(value) {
  return String(value || "").replace(/\\([\\`*_[\]{}()#+.!|>-])/g, "$1");
}

async function walkMarkdown(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walkMarkdown(fullPath, relativePath));
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      const fileStat = await stat(fullPath);
      output.push({
        path: relativePath,
        title: basename(entry.name, extname(entry.name)),
        modified: fileStat.mtimeMs,
        size: fileStat.size,
      });
    }
  }
  return output;
}

async function listNotes() {
  const notes = await walkMarkdown(NOTES_DIR);
  return notes.sort((a, b) => a.path.localeCompare(b.path, "pt-BR"));
}

async function walkFolders(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    output.push(relativePath);
    output.push(...await walkFolders(join(directory, entry.name), relativePath));
  }
  return output;
}

async function listFolders() {
  const noteFolders = await walkFolders(NOTES_DIR);
  if (CUSTOM_VAULT_DIR) return noteFolders.sort((a, b) => a.localeCompare(b, "pt-BR"));
  const vaultFolders = (await walkFolders(VAULT_DIR))
    .filter((path) => path !== "notes" && !path.startsWith("notes/"));
  return [...new Set([...noteFolders, ...vaultFolders])].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function assetKind(extension) {
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (extension === ".pdf") return "pdf";
  return "file";
}

async function walkVaultFiles(directory = VAULT_DIR, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walkVaultFiles(fullPath, relativePath));
    if (entry.isFile()) {
      const fileStat = await stat(fullPath);
      output.push({ path: relativePath, fullPath, modified: fileStat.mtimeMs, size: fileStat.size });
    }
  }
  return output;
}

async function listAssets() {
  const files = await walkVaultFiles();
  return files
    .filter((file) => !file.path.toLowerCase().endsWith(".md"))
    .map((file) => {
      const extension = extname(file.path).toLowerCase();
      return {
        path: file.path,
        title: basename(file.path),
        extension: extension.slice(1),
        kind: assetKind(extension),
        modified: file.modified,
        size: file.size,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path, "pt-BR"));
}

function timestampFolder() {
  return new Date().toISOString().replaceAll(":", "-").replace("T", "_").replace("Z", "");
}

async function backupNote(fullPath, notePath) {
  if (!await exists(fullPath)) return;
  const destination = join(HISTORY_DIR, timestampFolder(), notePath);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(fullPath, destination);
}

async function writeNote(fullPath, notePath, content, makeBackup = true) {
  await mkdir(dirname(fullPath), { recursive: true });
  if (makeBackup) await backupNote(fullPath, notePath);
  const temporary = `${fullPath}.pentamark-${process.pid}-${Date.now()}.tmp`;
  await writeFile(temporary, content, "utf8");
  if (await exists(fullPath)) await unlink(fullPath);
  await rename(temporary, fullPath);
  return revisionFor(content);
}

function eventPayload(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function broadcast(event, payload) {
  const frame = eventPayload(event, payload);
  for (const client of sseClients.values()) {
    for (const response of client.responses) response.write(frame);
  }
}

function cleanClientAddress(value) {
  return String(value || "desconhecido").replace(/^::ffff:/, "");
}

function isLocalAddress(value) {
  const address = cleanClientAddress(value);
  return address === "::1" || address === "127.0.0.1";
}

function isLocalRequest(req) {
  return isLocalAddress(req.socket.remoteAddress);
}

function connectedClients() {
  const browserClients = [...sseClients.values()]
    .map((client) => ({ ...client.info, sessions: client.responses.size, permission: client.info.local ? "admin" : config.userPermissions?.[client.info.id] || "editor" }));
  const recentMcp = [...mcpActivity.values()].filter((client) => Date.now() - client.lastSeen < 60_000);
  return [...browserClients, ...recentMcp]
    .sort((a, b) => Number(b.local) - Number(a.local) || a.connectedAt - b.connectedAt);
}

function clientIdFromRequest(req) {
  return String(req.headers["x-pentamark-client"] || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

function requestPermission(req) {
  if (isLocalRequest(req)) return "admin";
  const clientId = clientIdFromRequest(req);
  return config.userPermissions?.[clientId] || "editor";
}

function markMcpActivity(req, action, path = "", editing = false) {
  const address = cleanClientAddress(req.socket.remoteAddress);
  const id = `mcp-${address.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const previous = mcpActivity.get(id);
  const rawPath = String(path || "").replaceAll("\\", "/");
  const activePath = /\.md$/i.test(rawPath) ? (!CUSTOM_VAULT_DIR && rawPath.startsWith("notes/") ? rawPath.slice(6) : rawPath) : "";
  mcpActivity.set(id, {
    id, name: "IA / MCP", address, connectedAt: previous?.connectedAt || Date.now(), lastSeen: Date.now(), local: isLocalAddress(address), sessions: 1,
    activePath, cursor: 0, selectionEnd: 0, mode: "preview", editing: Boolean(editing), avatar: "", color: "#a78bfa", permission: "admin", viaMcp: true, action,
  });
  broadcastPresence();
}

function currentLocks() {
  return [...noteLocks.entries()].map(([path, clientId]) => ({
    path,
    clientId,
    name: sseClients.get(clientId)?.info.name || "Outro usuário",
  }));
}

function releaseClientLocks(clientId) {
  let changed = false;
  for (const [path, owner] of noteLocks) {
    if (owner === clientId) {
      noteLocks.delete(path);
      changed = true;
    }
  }
  return changed;
}

function lockFor(path) {
  const clientId = noteLocks.get(path);
  if (!clientId) return null;
  return { clientId, name: sseClients.get(clientId)?.info.name || "Outro usuário" };
}

function lockedByOther(path, clientId) {
  if (!config.lockEditedNotes) return null;
  const lock = lockFor(path);
  return lock && lock.clientId !== clientId ? lock : null;
}

function folderLockedByOther(path, clientId) {
  if (!config.lockEditedNotes) return null;
  for (const [notePath, owner] of noteLocks) {
    if (notePath.startsWith(`${path}/`) && owner !== clientId) return { clientId: owner, name: sseClients.get(owner)?.info.name || "Outro usuário" };
  }
  return null;
}

function broadcastPresence() {
  broadcast("presence", { connections: connectedClients(), locks: currentLocks() });
}

function broadcastState() {
  const connections = connectedClients();
  broadcast("state", { clients: Math.max(1, connections.length), connections, locks: currentLocks() });
}

function networkUrls() {
  const urls = [`http://localhost:${runtimePort}`];
  const addresses = [];
  let interfaces = {};
  try {
    interfaces = networkInterfaces();
  } catch {
    // Alguns ambientes isolados não permitem enumerar as interfaces.
  }
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  addresses.sort((a, b) => Number(b.startsWith("26.")) - Number(a.startsWith("26.")) || a.localeCompare(b));
  for (const address of addresses) urls.push(`http://${address}:${runtimePort}`);
  return [...new Set(urls)];
}

async function loadConfig() {
  if (!await exists(CONFIG_PATH)) {
    const initial = { ...DEFAULT_CONFIG, aiBridgeToken: randomBytes(18).toString("hex") };
    await writeFile(CONFIG_PATH, `${JSON.stringify(initial, null, 2)}\n`, "utf8");
    return initial;
  }
  try {
    const userConfig = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
    const merged = { ...DEFAULT_CONFIG, ...userConfig };
    if (!merged.aiBridgeToken) {
      merged.aiBridgeToken = randomBytes(18).toString("hex");
      await writeFile(CONFIG_PATH, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    }
    return merged;
  } catch {
    console.warn("[PentaMark] Configuração inválida; usando os valores padrão.");
    return { ...DEFAULT_CONFIG, aiBridgeToken: randomBytes(18).toString("hex") };
  }
}

async function ensureVault() {
  await Promise.all([
    mkdir(NOTES_DIR, { recursive: true }),
    mkdir(ASSETS_DIR, { recursive: true }),
    mkdir(HISTORY_DIR, { recursive: true }),
    mkdir(TRASH_DIR, { recursive: true }),
  ]);

  const welcome = noteTarget("00 — Comece aqui.md");
  if (await exists(welcome.fullPath) && await readFile(welcome.fullPath, "utf8") === LEGACY_WELCOME) {
    await writeNote(welcome.fullPath, welcome.path, BOOTSTRAP_NOTES[welcome.path], true);
  }

  const legacyDevlog = noteTarget("Pentagory/DEVLOG.md");
  if (await exists(legacyDevlog.fullPath) && await readFile(legacyDevlog.fullPath, "utf8") === LEGACY_DEVLOG) {
    const migrated = join(TRASH_DIR, "migration-2.2", legacyDevlog.path);
    await mkdir(dirname(migrated), { recursive: true });
    await rename(legacyDevlog.fullPath, migrated);
    await rmdir(dirname(legacyDevlog.fullPath)).catch(() => undefined);
  }

  const currentNotes = await listNotes();
  if (currentNotes.length === 0) {
    for (const [path, content] of Object.entries(BOOTSTRAP_NOTES)) {
      const target = noteTarget(path);
      await writeNote(target.fullPath, target.path, content, false);
    }
  }
}

function safeAssetName(input) {
  const decoded = input || "arquivo";
  const extension = extname(decoded).slice(0, 16).replace(/[^a-zA-Z0-9.]/g, "");
  const stem = basename(decoded, extname(decoded))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 _.-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100) || "arquivo";
  return `${stem}${extension.toLowerCase()}`;
}

async function uniqueAssetPath(requestedName) {
  const clean = safeAssetName(requestedName);
  const extension = extname(clean);
  const stem = basename(clean, extension);
  for (let index = 0; index < 10_000; index += 1) {
    const name = index === 0 ? clean : `${stem}-${index}${extension}`;
    const fullPath = join(ASSETS_DIR, name);
    if (!await exists(fullPath)) return { name, fullPath };
  }
  throw new Error("Não foi possível escolher um nome para o arquivo");
}

function markdownForAsset(name, contentType) {
  const vaultPath = `assets/${name}`;
  const extension = extname(name).toLowerCase();
  const image = contentType.startsWith("image/") || [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".bmp"].includes(extension);
  const video = contentType.startsWith("video/") || [".mp4", ".webm", ".mov", ".mkv", ".ogv"].includes(extension);
  const audio = contentType.startsWith("audio/") || [".mp3", ".wav", ".ogg", ".flac", ".m4a", ".3gp"].includes(extension);
  if (image || video || audio || extension === ".pdf") return `![[${vaultPath}]]`;
  return `[[${vaultPath}|${name}]]`;
}

function insideDirectory(candidate, directory) {
  return candidate === directory || candidate.startsWith(`${directory}${sep}`);
}

async function findByBasename(directory, requestedName) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = join(directory, entry.name);
    if (entry.isFile() && entry.name.localeCompare(requestedName, undefined, { sensitivity: "accent" }) === 0) return fullPath;
    if (entry.isDirectory()) {
      const nested = await findByBasename(fullPath, requestedName);
      if (nested) return nested;
    }
  }
  return "";
}

async function resolveVaultFile(requestedPath, notePath = "") {
  const raw = unescapeMarkdownPath(requestedPath).trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!raw || raw.includes("\0")) throw new Error("Caminho inválido");
  const withoutFragment = raw.split("#", 1)[0];
  const noteDirectory = notePath ? dirname(noteTarget(notePath).fullPath) : NOTES_DIR;
  const candidates = [resolve(noteDirectory, withoutFragment), resolve(VAULT_DIR, withoutFragment)];
  const realVault = await realpath(VAULT_DIR);
  for (const candidate of candidates) {
    if (!insideDirectory(candidate, VAULT_DIR) || !await exists(candidate)) continue;
    const realCandidate = await realpath(candidate);
    if (insideDirectory(realCandidate, realVault) && (await stat(realCandidate)).isFile()) return realCandidate;
  }
  if (!withoutFragment.includes("/")) {
    const found = await findByBasename(VAULT_DIR, basename(withoutFragment));
    if (found) return found;
  }
  throw new Error("Arquivo não encontrado");
}

function vaultTarget(input) {
  const path = cleanRelativePath(unescapeMarkdownPath(input), false);
  if (path === ".history" || path.startsWith(".history/") || path === ".trash" || path.startsWith(".trash/")) throw new Error("Esse diretório interno é protegido");
  const fullPath = resolve(VAULT_DIR, path);
  if (!fullPath.startsWith(`${VAULT_DIR}${sep}`)) throw new Error("Caminho inválido");
  return { path, fullPath };
}

function markdownReferences(content) {
  const references = [];
  for (const match of content.matchAll(/!?\[\[([^\]|#^]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) references.push(unescapeMarkdownPath(match[1].trim()));
  for (const match of content.matchAll(/!?\[[^\]]*\]\((?:<)?([^)>\s]+)(?:>)?(?:\s+["'][^"']*["'])?\)/g)) references.push(unescapeMarkdownPath(match[1].trim()));
  return references.filter((path) => path && !/^(?:https?:|mailto:|data:|#)/i.test(path));
}

async function referencedVaultFiles() {
  const references = new Set();
  for (const note of await listNotes()) {
    const target = noteTarget(note.path);
    const content = await readFile(target.fullPath, "utf8");
    for (const reference of markdownReferences(content)) {
      try { references.add(await realpath(await resolveVaultFile(reference, note.path))); }
      catch { /* links ainda não resolvidos não contam como assets */ }
    }
  }
  return references;
}

async function cleanupUnusedAssets() {
  if (!config.cleanupUnusedAssets) return [];
  const referenced = await referencedVaultFiles();
  const moved = [];
  for (const file of await walkVaultFiles()) {
    if (!CLEANABLE_EXTENSIONS.has(extname(file.path).toLowerCase())) continue;
    const canonical = await realpath(file.fullPath).catch(() => file.fullPath);
    if (referenced.has(canonical)) continue;
    const destination = join(TRASH_DIR, "unused-assets", timestampFolder(), file.path);
    await mkdir(dirname(destination), { recursive: true });
    await rename(file.fullPath, destination).catch(() => undefined);
    if (await exists(destination)) moved.push(file.path);
  }
  if (moved.length) broadcast("notes", { reason: "unused-assets", moved });
  return moved;
}

function scheduleUnusedAssetCleanup() {
  if (!config.cleanupUnusedAssets) return;
  if (cleanupTimer) clearTimeout(cleanupTimer);
  cleanupTimer = setTimeout(() => {
    cleanupTimer = null;
    void cleanupUnusedAssets().catch((error) => console.warn(`[PentaMark] Limpeza de assets falhou: ${error.message}`));
  }, 1400);
}

function aiTokenFromRequest(req, url) {
  const authorization = String(req.headers.authorization || "");
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  return bearer || url.searchParams.get("token") || "";
}

function aiBridgeAuthorized(req, url) {
  if (!config.aiBridgeEnabled) return false;
  return Boolean(config.aiBridgeToken) && aiTokenFromRequest(req, url) === config.aiBridgeToken;
}

function textMime(extension) {
  return TEXT_EXTENSIONS.has(extension);
}

function mcpBridge(req) {
  return {
    async listFiles(filter = "", limit = 1000) {
      markMcpActivity(req, "listando arquivos", String(filter || ""), false);
      const needle = String(filter).toLocaleLowerCase("pt-BR");
      return (await walkVaultFiles())
        .filter((file) => !needle || file.path.toLocaleLowerCase("pt-BR").includes(needle))
        .slice(0, limit)
        .map((file) => ({ path: file.path, size: file.size, modified: new Date(file.modified).toISOString(), kind: assetKind(extname(file.path).toLowerCase()) }));
    },
    async readFile(path, startLine, endLine) {
      markMcpActivity(req, "lendo arquivo", path, false);
      const target = vaultTarget(path);
      const extension = extname(target.path).toLowerCase();
      if (!textMime(extension)) throw new Error("Esse arquivo é binário; use open_asset");
      const content = await readFile(target.fullPath, "utf8");
      const lines = content.split(/\r?\n/);
      const start = Math.max(1, Number(startLine) || 1);
      const end = Math.min(lines.length, Number(endLine) || lines.length);
      return { path: target.path, revision: revisionFor(content), total_lines: lines.length, start_line: start, end_line: end, content: lines.slice(start - 1, end).join("\n") };
    },
    async openAsset(path) {
      markMcpActivity(req, "visualizando asset", path, false);
      const target = vaultTarget(path);
      const fileStat = await stat(target.fullPath);
      if (!fileStat.isFile()) throw new Error("Arquivo não encontrado");
      const protocol = String(req.headers["x-forwarded-proto"] || "http").split(",")[0];
      const host = String(req.headers.host || `localhost:${runtimePort}`);
      return { path: target.path, name: basename(target.path), mimeType: MIME_TYPES[extname(target.path).toLowerCase()] || "application/octet-stream", url: `${protocol}://${host}/api/file?path=${encodeURIComponent(target.path)}` };
    },
    async searchFiles(query, pathPrefix = "", limit = 100) {
      markMcpActivity(req, "pesquisando", pathPrefix || query, false);
      const needle = String(query).toLocaleLowerCase("pt-BR");
      const prefix = String(pathPrefix).replaceAll("\\", "/").replace(/^\/+/, "").toLocaleLowerCase("pt-BR");
      const matches = [];
      for (const file of await walkVaultFiles()) {
        if (matches.length >= limit || (prefix && !file.path.toLocaleLowerCase("pt-BR").startsWith(prefix)) || !textMime(extname(file.path).toLowerCase()) || file.size > 4 * 1024 * 1024) continue;
        const content = await readFile(file.fullPath, "utf8");
        content.split(/\r?\n/).forEach((line, index) => {
          if (matches.length < limit && line.toLocaleLowerCase("pt-BR").includes(needle)) matches.push({ path: file.path, line: index + 1, text: line.slice(0, 500) });
        });
      }
      return matches;
    },
    async writeFile(path, content, expectedRevision) {
      markMcpActivity(req, "editando arquivo", path, true);
      const target = vaultTarget(path);
      if (!textMime(extname(target.path).toLowerCase())) throw new Error("A Ponte IA só grava arquivos textuais");
      if (await exists(target.fullPath)) {
        const current = await readFile(target.fullPath, "utf8");
        const currentRevision = revisionFor(current);
        if (expectedRevision && expectedRevision !== currentRevision) throw new Error(`Conflito: revisão atual ${currentRevision}`);
      }
      await mkdir(dirname(target.fullPath), { recursive: true });
      const notePath = target.path.startsWith("notes/") && !CUSTOM_VAULT_DIR ? target.path.slice(6) : CUSTOM_VAULT_DIR && target.path.toLowerCase().endsWith(".md") ? target.path : "";
      const revision = notePath ? await writeNote(target.fullPath, notePath, String(content), true) : (await writeFile(target.fullPath, String(content), "utf8"), revisionFor(String(content)));
      if (notePath) broadcast("note", { path: notePath, revision, source: "ai" });
      broadcast("notes", { reason: "ai-write", path: target.path });
      scheduleUnusedAssetCleanup();
      return { ok: true, path: target.path, revision };
    },
    async moveFile(path, newPath) {
      markMcpActivity(req, "movendo arquivo", path, true);
      const source = vaultTarget(path);
      const destination = vaultTarget(newPath);
      if (!await exists(source.fullPath)) throw new Error("Arquivo não encontrado");
      if (await exists(destination.fullPath)) throw new Error("Já existe um arquivo no destino");
      await mkdir(dirname(destination.fullPath), { recursive: true });
      await rename(source.fullPath, destination.fullPath);
      broadcast("notes", { reason: "ai-move", path: source.path, newPath: destination.path });
      return { ok: true, path: destination.path };
    },
    async deleteFile(path) {
      markMcpActivity(req, "enviando à lixeira", path, true);
      const target = vaultTarget(path);
      if (!await exists(target.fullPath)) throw new Error("Arquivo não encontrado");
      const destination = join(TRASH_DIR, "ai", timestampFolder(), target.path);
      await mkdir(dirname(destination), { recursive: true });
      await rename(target.fullPath, destination);
      broadcast("notes", { reason: "ai-delete", path: target.path });
      return { ok: true, moved_to_trash: target.path };
    },
  };
}

async function handleUpload(req, res, url) {
  const requestedName = url.searchParams.get("name") || "arquivo";
  const asset = await uniqueAssetPath(requestedName);
  const maxBytes = Math.max(1, Number(config.maxUploadMB) || 2048) * 1024 * 1024;
  let received = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) callback(new Error("Arquivo grande demais"));
      else callback(null, chunk);
    },
  });
  try {
    await pipeline(req, limiter, createWriteStream(asset.fullPath, { flags: "wx" }));
  } catch (error) {
    if (await exists(asset.fullPath)) await unlink(asset.fullPath);
    throw error;
  }
  const contentType = String(req.headers["content-type"] || MIME_TYPES[extname(asset.name).toLowerCase()] || "application/octet-stream");
  const assetUrl = `/uploads/${encodeURIComponent(asset.name)}`;
  broadcast("notes", { reason: "asset", name: asset.name });
  json(res, 201, {
    name: asset.name,
    url: assetUrl,
    size: received,
    markdown: markdownForAsset(asset.name, contentType),
  });
}

async function serveFile(req, res, filePath, explicitType) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("Arquivo não encontrado");
  const contentType = explicitType || MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream";
  const range = req.headers.range;

  if (range && fileStat.size > 0) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.writeHead(416, { "Content-Range": `bytes */${fileStat.size}` });
      res.end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), fileStat.size - 1) : fileStat.size - 1;
    if (start > end || start >= fileStat.size) {
      res.writeHead(416, { "Content-Range": `bytes */${fileStat.size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      "Content-Type": contentType,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": fileStat.size,
    "Accept-Ranges": "bytes",
    "Cache-Control": filePath.startsWith(ASSETS_DIR) ? "public, max-age=3600" : "no-cache",
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(filePath).pipe(res);
}

async function handleApi(req, res, url) {
  const mutation = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method || "");
  const permission = requestPermission(req);
  if (mutation && url.pathname !== "/api/presence" && url.pathname !== "/api/config" && url.pathname !== "/api/permission" && permission === "viewer") {
    errorJson(res, 403, "Sua permissão neste cofre é somente leitura");
    return true;
  }
  if (req.method === "DELETE" && permission === "editor") {
    errorJson(res, 403, "Somente administradores podem excluir itens do cofre");
    return true;
  }
  if (url.pathname === "/api/state" && req.method === "GET") {
    const connections = connectedClients();
    json(res, 200, {
      app: "PentaMark",
      protocolVersion: 6,
      notes: await listNotes(),
      assets: await listAssets(),
      folders: await listFolders(),
      clients: Math.max(1, connections.length),
      connections,
      locks: currentLocks(),
      urls: networkUrls(),
      vaultName: config.vaultName,
    });
    return true;
  }

  if (url.pathname === "/api/file" && req.method === "GET") {
    const filePath = await resolveVaultFile(url.searchParams.get("path"), url.searchParams.get("note") || "");
    await serveFile(req, res, filePath);
    return true;
  }

  if (url.pathname === "/api/config" && req.method === "GET") {
    const isHost = isLocalRequest(req);
    json(res, 200, {
      vaultName: config.vaultName,
      port: config.port,
      openBrowser: config.openBrowser,
      maxUploadMB: config.maxUploadMB,
      lockEditedNotes: Boolean(config.lockEditedNotes),
      cleanupUnusedAssets: Boolean(config.cleanupUnusedAssets),
      aiBridgeEnabled: Boolean(config.aiBridgeEnabled),
      aiBridgeToken: isHost ? config.aiBridgeToken : "",
      userPermissions: isHost ? config.userPermissions || {} : {},
      isHost,
    });
    return true;
  }

  if (url.pathname === "/api/permission" && req.method === "PUT") {
    if (!isLocalRequest(req)) {
      errorJson(res, 403, "Somente o host pode alterar permissões");
      return true;
    }
    const body = await readJsonBody(req, 64 * 1024);
    const clientId = String(body.clientId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
    const permission = ["viewer", "editor", "admin"].includes(body.permission) ? body.permission : "editor";
    if (!clientId) throw new Error("Usuário inválido");
    config = { ...config, userPermissions: { ...(config.userPermissions || {}), [clientId]: permission } };
    const connection = sseClients.get(clientId);
    if (permission === "viewer") {
      releaseClientLocks(clientId);
      if (connection) connection.info.editing = false;
    }
    await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    broadcastPresence();
    json(res, 200, { ok: true, clientId, permission });
    return true;
  }

  if (url.pathname === "/api/config" && req.method === "PUT") {
    if (!isLocalRequest(req)) {
      errorJson(res, 403, "Somente o host pode alterar estas configurações");
      return true;
    }
    const body = await readJsonBody(req, 64 * 1024);
    config = {
      ...config,
      vaultName: String(body.vaultName || config.vaultName).trim().slice(0, 80) || "PentaMark",
      port: Math.min(65_535, Math.max(1_024, Number(body.port) || config.port)),
      openBrowser: Boolean(body.openBrowser),
      maxUploadMB: Math.min(16_384, Math.max(1, Number(body.maxUploadMB) || config.maxUploadMB)),
      lockEditedNotes: Boolean(body.lockEditedNotes),
      cleanupUnusedAssets: Boolean(body.cleanupUnusedAssets),
      aiBridgeEnabled: Boolean(body.aiBridgeEnabled),
      aiBridgeToken: typeof body.aiBridgeToken === "string" && /^[a-zA-Z0-9_-]{16,128}$/.test(body.aiBridgeToken) ? body.aiBridgeToken : config.aiBridgeToken,
      userPermissions: config.userPermissions || {},
    };
    if (!config.lockEditedNotes) noteLocks.clear();
    else {
      for (const client of connectedClients()) {
        if (client.activePath && client.editing && !noteLocks.has(client.activePath)) noteLocks.set(client.activePath, client.id);
      }
    }
    await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    broadcast("config", { vaultName: config.vaultName });
    json(res, 200, {
      vaultName: config.vaultName,
      port: config.port,
      openBrowser: config.openBrowser,
      maxUploadMB: config.maxUploadMB,
      lockEditedNotes: config.lockEditedNotes,
      cleanupUnusedAssets: config.cleanupUnusedAssets,
      aiBridgeEnabled: config.aiBridgeEnabled,
      aiBridgeToken: config.aiBridgeToken,
      userPermissions: config.userPermissions || {},
      isHost: true,
      restartRequired: true,
    });
    broadcastPresence();
    return true;
  }

  if (url.pathname === "/api/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 1800\n\n");
    const requestedId = String(url.searchParams.get("clientId") || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
    const clientId = requestedId || `anonymous-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const requestedName = String(url.searchParams.get("name") || "").trim().replace(/[\r\n\t]/g, " ").slice(0, 60);
    const address = cleanClientAddress(req.socket.remoteAddress);
    const local = isLocalAddress(address);
    const current = sseClients.get(clientId);
    const connection = current || {
      info: {
        id: clientId,
        name: requestedName || (local ? "Host local" : "Dispositivo remoto"),
        address,
        local,
        connectedAt: Date.now(),
        lastSeen: Date.now(),
        activePath: "",
        cursor: 0,
        selectionEnd: 0,
        mode: "edit",
        editing: false,
        avatar: "",
        color: "#67e7ef",
      },
      responses: new Set(),
    };
    connection.info.name = requestedName || connection.info.name;
    connection.info.address = address;
    connection.info.local = local;
    connection.info.lastSeen = Date.now();
    connection.responses.add(res);
    sseClients.set(clientId, connection);
    broadcastState();
    const keepAlive = setInterval(() => res.write(": ping\n\n"), 20_000);
    req.on("close", () => {
      clearInterval(keepAlive);
      const saved = sseClients.get(clientId);
      saved?.responses.delete(res);
      if (saved && saved.responses.size === 0) {
        sseClients.delete(clientId);
        releaseClientLocks(clientId);
      }
      broadcastState();
      broadcastPresence();
    });
    return true;
  }

  if (url.pathname === "/api/presence" && req.method === "POST") {
    const body = await readJsonBody(req, 256 * 1024);
    const clientId = String(body.clientId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
    const connection = sseClients.get(clientId);
    if (!connection) {
      errorJson(res, 404, "Conexão ainda não registrada");
      return true;
    }

    const previousPath = connection.info.activePath || "";
    const requestedPath = body.path ? noteTarget(body.path).path : "";
    if (previousPath !== requestedPath && noteLocks.get(previousPath) === clientId) noteLocks.delete(previousPath);

    const wantsToEdit = body.editing !== false && (connection.info.local || (config.userPermissions?.[clientId] || "editor") !== "viewer");
    const blocking = requestedPath && wantsToEdit ? lockedByOther(requestedPath, clientId) : null;
    connection.info.name = String(body.name || connection.info.name).trim().replace(/[\r\n\t]/g, " ").slice(0, 60) || connection.info.name;
    connection.info.avatar = typeof body.avatar === "string" && /^data:image\/(?:png|jpeg|webp);base64,/i.test(body.avatar) && body.avatar.length <= 150_000 ? body.avatar : "";
    connection.info.color = typeof body.color === "string" && /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : connection.info.color;
    connection.info.activePath = requestedPath;
    connection.info.cursor = Math.max(0, Math.min(20_000_000, Number(body.cursor) || 0));
    connection.info.selectionEnd = Math.max(0, Math.min(20_000_000, Number(body.selectionEnd) || connection.info.cursor));
    connection.info.mode = ["edit", "split", "preview", "live"].includes(body.mode) ? body.mode : "edit";
    connection.info.editing = Boolean(requestedPath) && !blocking && wantsToEdit;
    connection.info.lastSeen = Date.now();

    if (noteLocks.get(requestedPath) === clientId && !connection.info.editing) noteLocks.delete(requestedPath);
    if (config.lockEditedNotes && requestedPath && !blocking && connection.info.editing) noteLocks.set(requestedPath, clientId);
    broadcastPresence();
    if (blocking) {
      json(res, 423, { error: `${blocking.name} está editando este arquivo`, lockedBy: blocking });
      return true;
    }
    json(res, 200, { ok: true, lock: requestedPath ? lockFor(requestedPath) : null });
    return true;
  }

  if (url.pathname === "/api/note" && req.method === "GET") {
    const target = noteTarget(url.searchParams.get("path"));
    const content = await readFile(target.fullPath, "utf8");
    const fileStat = await stat(target.fullPath);
    json(res, 200, {
      path: target.path,
      title: basename(target.path, extname(target.path)),
      content,
      revision: revisionFor(content),
      modified: fileStat.mtimeMs,
      size: fileStat.size,
    });
    return true;
  }

  if (url.pathname === "/api/note" && req.method === "POST") {
    const body = await readJsonBody(req);
    const target = noteTarget(body.path);
    if (await exists(target.fullPath)) {
      errorJson(res, 409, "Essa nota já existe");
      return true;
    }
    const content = typeof body.content === "string" ? body.content : "";
    const revision = await writeNote(target.fullPath, target.path, content, false);
    broadcast("notes", { reason: "created", path: target.path });
    json(res, 201, { path: target.path, revision });
    return true;
  }

  if (url.pathname === "/api/note" && req.method === "PUT") {
    const target = noteTarget(url.searchParams.get("path"));
    const body = await readJsonBody(req);
    if (typeof body.content !== "string") throw new Error("Conteúdo inválido");
    const clientId = String(body.clientId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
    const blocking = lockedByOther(target.path, clientId);
    if (blocking) {
      json(res, 423, { error: `${blocking.name} está editando este arquivo`, lockedBy: blocking });
      return true;
    }
    if (config.lockEditedNotes && clientId && !noteLocks.has(target.path)) noteLocks.set(target.path, clientId);
    if (await exists(target.fullPath)) {
      const current = await readFile(target.fullPath, "utf8");
      const currentRevision = revisionFor(current);
      if (body.baseRevision && body.baseRevision !== currentRevision) {
        json(res, 409, { error: "A nota foi alterada em outro dispositivo", currentRevision });
        return true;
      }
      if (current === body.content) {
        json(res, 200, { path: target.path, revision: currentRevision, unchanged: true });
        return true;
      }
    }
    const revision = await writeNote(target.fullPath, target.path, body.content, true);
    broadcast("note", { path: target.path, revision });
    scheduleUnusedAssetCleanup();
    json(res, 200, { path: target.path, revision });
    return true;
  }

  if (url.pathname === "/api/note" && req.method === "PATCH") {
    const source = noteTarget(url.searchParams.get("path"));
    const body = await readJsonBody(req);
    const clientId = String(body.clientId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
    const blocking = lockedByOther(source.path, clientId);
    if (blocking) {
      json(res, 423, { error: `${blocking.name} está editando este arquivo`, lockedBy: blocking });
      return true;
    }
    const destination = noteTarget(body.newPath);
    if (!await exists(source.fullPath)) throw new Error("Nota não encontrada");
    if (await exists(destination.fullPath)) {
      errorJson(res, 409, "Já existe uma nota nesse caminho");
      return true;
    }
    await mkdir(dirname(destination.fullPath), { recursive: true });
    await rename(source.fullPath, destination.fullPath);
    if (noteLocks.get(source.path)) {
      const owner = noteLocks.get(source.path);
      noteLocks.delete(source.path);
      noteLocks.set(destination.path, owner);
    }
    broadcast("notes", { reason: "renamed", path: source.path, newPath: destination.path });
    broadcastPresence();
    json(res, 200, { path: destination.path });
    return true;
  }

  if (url.pathname === "/api/note" && req.method === "DELETE") {
    const target = noteTarget(url.searchParams.get("path"));
    const clientId = String(url.searchParams.get("clientId") || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
    const blocking = lockedByOther(target.path, clientId);
    if (blocking) {
      json(res, 423, { error: `${blocking.name} está editando este arquivo`, lockedBy: blocking });
      return true;
    }
    if (!await exists(target.fullPath)) throw new Error("Nota não encontrada");
    const trashPath = join(TRASH_DIR, timestampFolder(), target.path);
    await mkdir(dirname(trashPath), { recursive: true });
    await rename(target.fullPath, trashPath);
    noteLocks.delete(target.path);
    broadcast("notes", { reason: "deleted", path: target.path });
    broadcastPresence();
    json(res, 200, { deleted: target.path });
    return true;
  }

  if (url.pathname === "/api/folder" && req.method === "POST") {
    const body = await readJsonBody(req, 64 * 1024);
    const target = folderTarget(body.path);
    if (await exists(target.fullPath)) {
      errorJson(res, 409, "Essa pasta já existe");
      return true;
    }
    await mkdir(target.fullPath, { recursive: true });
    broadcast("notes", { reason: "folder-created", path: target.path });
    json(res, 201, { path: target.path });
    return true;
  }

  if (url.pathname === "/api/folder" && req.method === "PATCH") {
    const source = folderTarget(url.searchParams.get("path"));
    const body = await readJsonBody(req, 64 * 1024);
    const clientId = String(body.clientId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
    const blocking = folderLockedByOther(source.path, clientId);
    if (blocking) {
      json(res, 423, { error: `${blocking.name} está editando um arquivo desta pasta`, lockedBy: blocking });
      return true;
    }
    const destination = folderTarget(body.newPath);
    if (!await exists(source.fullPath)) throw new Error("Pasta não encontrada");
    if (await exists(destination.fullPath)) {
      errorJson(res, 409, "Já existe uma pasta nesse caminho");
      return true;
    }
    await mkdir(dirname(destination.fullPath), { recursive: true });
    await rename(source.fullPath, destination.fullPath);
    for (const [path, owner] of [...noteLocks.entries()]) {
      if (path.startsWith(`${source.path}/`)) {
        noteLocks.delete(path);
        noteLocks.set(`${destination.path}${path.slice(source.path.length)}`, owner);
      }
    }
    broadcast("notes", { reason: "folder-renamed", path: source.path, newPath: destination.path });
    broadcastPresence();
    json(res, 200, { path: destination.path });
    return true;
  }

  if (url.pathname === "/api/folder" && req.method === "DELETE") {
    const target = folderTarget(url.searchParams.get("path"));
    const clientId = String(url.searchParams.get("clientId") || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
    const blocking = folderLockedByOther(target.path, clientId);
    if (blocking) {
      json(res, 423, { error: `${blocking.name} está editando um arquivo desta pasta`, lockedBy: blocking });
      return true;
    }
    if (!await exists(target.fullPath)) throw new Error("Pasta não encontrada");
    const trashPath = join(TRASH_DIR, timestampFolder(), "folders", target.path);
    await mkdir(dirname(trashPath), { recursive: true });
    await rename(target.fullPath, trashPath);
    for (const path of [...noteLocks.keys()]) {
      if (path.startsWith(`${target.path}/`)) noteLocks.delete(path);
    }
    broadcast("notes", { reason: "folder-deleted", path: target.path });
    broadcastPresence();
    json(res, 200, { deleted: target.path });
    return true;
  }

  if (url.pathname === "/api/asset" && req.method === "PATCH") {
    const source = vaultTarget(url.searchParams.get("path"));
    const body = await readJsonBody(req, 64 * 1024);
    const destination = vaultTarget(body.newPath);
    if (!await exists(source.fullPath)) throw new Error("Asset não encontrado");
    if (await exists(destination.fullPath)) {
      errorJson(res, 409, "Já existe um arquivo nesse caminho");
      return true;
    }
    await mkdir(dirname(destination.fullPath), { recursive: true });
    await rename(source.fullPath, destination.fullPath);
    broadcast("notes", { reason: "asset-renamed", path: source.path, newPath: destination.path });
    json(res, 200, { path: destination.path });
    return true;
  }

  if (url.pathname === "/api/asset" && req.method === "DELETE") {
    const target = vaultTarget(url.searchParams.get("path"));
    if (!await exists(target.fullPath)) throw new Error("Asset não encontrado");
    const trashPath = join(TRASH_DIR, timestampFolder(), "assets", target.path);
    await mkdir(dirname(trashPath), { recursive: true });
    await rename(target.fullPath, trashPath);
    broadcast("notes", { reason: "asset-deleted", path: target.path });
    json(res, 200, { deleted: target.path });
    return true;
  }

  if (url.pathname === "/api/upload" && req.method === "POST") {
    await handleUpload(req, res, url);
    return true;
  }

  return false;
}

async function requestHandler(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/mcp") {
      if (req.method === "GET") {
        json(res, 200, { app: "PentaMark", bridge: "MCP", enabled: Boolean(config.aiBridgeEnabled), authentication: "Bearer token ou ?token=" });
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405, { Allow: "GET, POST", "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }));
        return;
      }
      if (!aiBridgeAuthorized(req, url)) {
        res.writeHead(config.aiBridgeEnabled ? 401 : 403, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: config.aiBridgeEnabled ? "Token da Ponte IA inválido" : "Ponte IA desabilitada pelo host" }, id: null }));
        return;
      }
      const body = JSON.parse((await readRawBody(req, 2 * 1024 * 1024)).toString("utf8") || "{}");
      await handleMcpRequest(req, res, body, mcpBridge(req));
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      if (!await handleApi(req, res, url)) errorJson(res, 404, "Rota não encontrada");
      return;
    }

    if (url.pathname.startsWith("/uploads/")) {
      const name = cleanRelativePath(decodeURIComponent(url.pathname.slice("/uploads/".length)));
      const filePath = resolve(ASSETS_DIR, name);
      if (!filePath.startsWith(`${ASSETS_DIR}${sep}`)) throw new Error("Arquivo inválido");
      await serveFile(req, res, filePath);
      return;
    }

    // Compatibilidade com a v1.0.0: o Vite e os anexos usavam /assets.
    // A interface compilada tem prioridade; se não existir, buscamos no cofre.
    if (url.pathname.startsWith("/assets/")) {
      const name = cleanRelativePath(decodeURIComponent(url.pathname.slice("/assets/".length)));
      const interfaceAsset = resolve(DIST_DIR, "assets", name);
      if (interfaceAsset.startsWith(`${join(DIST_DIR, "assets")}${sep}`) && await exists(interfaceAsset)) {
        await serveFile(req, res, interfaceAsset);
        return;
      }
      const vaultAsset = resolve(ASSETS_DIR, name);
      if (!vaultAsset.startsWith(`${ASSETS_DIR}${sep}`)) throw new Error("Arquivo inválido");
      await serveFile(req, res, vaultAsset);
      return;
    }

    const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    let filePath = resolve(DIST_DIR, requested);
    if (!filePath.startsWith(`${DIST_DIR}${sep}`) && filePath !== DIST_DIR) throw new Error("Arquivo inválido");
    if (!await exists(filePath) || (await stat(filePath)).isDirectory()) filePath = join(DIST_DIR, "index.html");
    await serveFile(req, res, filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro inesperado";
    const status = /não encontrad|ENOENT/i.test(message) ? 404 : /grande demais/i.test(message) ? 413 : 400;
    if (!res.headersSent) errorJson(res, status, message);
    else res.end();
  }
}

function openBrowser(url) {
  if (!config.openBrowser || process.env.PENTAMARK_DESKTOP === "1") return;
  const options = { detached: true, stdio: "ignore" };
  try {
    if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], options).unref();
    else if (process.platform === "darwin") spawn("open", [url], options).unref();
    else spawn("xdg-open", [url], options).unref();
  } catch {
    // O endereço continua visível no terminal caso a abertura automática falhe.
  }
}

async function start() {
  await mkdir(DATA_DIR, { recursive: true });
  config = await loadConfig();
  runtimePort = Number(config.port);
  await ensureVault();
  if (!await exists(join(DIST_DIR, "index.html"))) {
    throw new Error("Interface não encontrada. Rode npm run local:build antes de iniciar.");
  }

  const server = createServer(requestHandler);
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.listen(runtimePort, String(config.bind), () => {
    const urls = networkUrls();
    console.log("\n  PentaMark está online :V\n");
    console.log(`  Este PC:  ${urls[0]}`);
    for (const url of urls.slice(1)) {
      const label = url.includes("//26.") ? "Radmin" : "Rede";
      console.log(`  ${label.padEnd(9)} ${url}`);
    }
    console.log("\n  Feche esta janela ou pressione Ctrl+C para encerrar.\n");
    setTimeout(() => openBrowser(urls[0]), 350);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") console.error(`\nA porta ${runtimePort} já está em uso. Talvez o PentaMark já esteja aberto.`);
    else console.error(error);
    process.exitCode = 1;
  });

  const shutdown = () => {
    for (const client of sseClients.values()) {
      for (const response of client.responses) response.end();
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((error) => {
  console.error(`\n[PentaMark] ${error.message}\n`);
  process.exitCode = 1;
});
