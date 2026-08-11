import DOMPurify from "dompurify";
import { marked } from "marked";
import mermaid from "mermaid";
import { parse as parseYaml } from "yaml";
import type { AssetMeta, NoteMeta, OpenNote } from "../../domain/types";
import { request } from "../../api/client";
import { baseName, joinPath, parentOf, titleOf } from "../../shared/path";
import { decodeSource, encodeSource, escapeAttribute, escapeCode } from "../../shared/text";
import hljs, { CODE_LANGUAGES } from "./highlighting";
import { renderKanban } from "./kanban";
import { decorateDocumentListMarkers } from "./document-elements";

marked.setOptions({ gfm: true, breaks: true });

marked.use({
  renderer: {
    code({ text, lang }) {
      const languageLine = String(lang || "").trim();
      const requested = languageLine.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9#+.-]/g, "");
      if (requested === "kanban") return renderKanban(text, languageLine || "kanban horizontal");
      if (requested === "mermaid") {
        const original = `\`\`\`mermaid\n${text}\n\`\`\``;
        return `<div class="pm-mermaid" data-pm-source="${escapeAttribute(encodeSource(text))}" data-pm-original="${escapeAttribute(encodeSource(original))}" contenteditable="false"><pre data-language="MERMAID"><code>${escapeCode(text)}</code></pre></div>\n`;
      }
      const language = CODE_LANGUAGES[requested];
      const highlighted = language ? hljs.highlight(text, { language: language.grammar }).value : escapeCode(text);
      const className = requested ? ` language-${requested}` : "";
      const label = language?.label || (requested ? requested.toUpperCase() : "");
      return `<pre${label ? ` data-language="${label}"` : ""}><code class="hljs${className}">${highlighted}</code></pre>\n`;
    },
  },
});
mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "dark", fontFamily: "monospace" });
export type MarkdownContext = { activePath: string; notes: NoteMeta[]; folders: string[]; assets: AssetMeta[] };

const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
const AUDIO_EXTENSIONS = new Set(["flac", "m4a", "mp3", "ogg", "wav", "webm", "3gp"]);
const VIDEO_EXTENSIONS = new Set(["mkv", "mov", "mp4", "ogv", "webm"]);

export function decodedLink(value: string) {
  try { return decodeURIComponent(value); }
  catch { return value; }
}

export function normalizeLinkPath(value: string) {
  const output: string[] = [];
  const unescaped = decodedLink(value).replace(/\\([\\`*_[\]{}()#+.!|>-])/g, "$1");
  for (const segment of unescaped.replaceAll("\\", "/").replace(/^\/+/, "").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") output.pop();
    else output.push(segment);
  }
  return output.join("/");
}

export function splitLinkTarget(value: string) {
  const hashAt = value.indexOf("#");
  const blockAt = value.indexOf("^");
  const cutAt = [hashAt, blockAt].filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? -1;
  return { path: (cutAt >= 0 ? value.slice(0, cutAt) : value).trim(), fragment: cutAt >= 0 ? value.slice(cutAt) : "" };
}

export function resolveNotePath(value: string, context: MarkdownContext) {
  const { path } = splitLinkTarget(value);
  if (!path) return context.activePath;
  const requested = normalizeLinkPath(path).replace(/\.md$/i, "");
  const parent = parentOf(context.activePath);
  const candidates = [requested, normalizeLinkPath(joinPath(parent, requested))].filter(Boolean);
  for (const candidate of candidates) {
    const exact = context.notes.find((note) => note.path.replace(/\.md$/i, "").localeCompare(candidate, undefined, { sensitivity: "accent" }) === 0);
    if (exact) return exact.path;
  }
  const byName = context.notes.filter((note) => titleOf(note.path).localeCompare(baseName(requested), undefined, { sensitivity: "accent" }) === 0);
  return byName.length === 1 ? byName[0].path : "";
}

export function resolveFolderPath(value: string, context: MarkdownContext) {
  const requested = normalizeLinkPath(splitLinkTarget(value).path);
  const parent = parentOf(context.activePath);
  return context.folders.find((folder) => folder.localeCompare(requested, undefined, { sensitivity: "accent" }) === 0)
    || context.folders.find((folder) => folder.localeCompare(normalizeLinkPath(joinPath(parent, requested)), undefined, { sensitivity: "accent" }) === 0)
    || "";
}

export function resolveAssetTarget(value: string, activePath: string, assets: AssetMeta[]) {
  const requested = normalizeLinkPath(splitLinkTarget(value).path);
  const parent = parentOf(activePath);
  const candidates = [requested, normalizeLinkPath(joinPath(parent, requested)), normalizeLinkPath(joinPath("assets", requested))];
  for (const candidate of candidates) {
    const match = assets.find((asset) => asset.path.localeCompare(candidate, undefined, { sensitivity: "accent" }) === 0);
    if (match) return match;
  }
  const byName = assets.filter((asset) => baseName(asset.path).localeCompare(baseName(requested), undefined, { sensitivity: "accent" }) === 0);
  return byName.length === 1 ? byName[0] : null;
}

export function extensionOfLink(value: string) {
  return splitLinkTarget(value).path.split(".").pop()?.toLowerCase() || "";
}

export function vaultFileUrl(value: string, activePath: string) {
  const { path, fragment } = splitLinkTarget(value);
  const query = new URLSearchParams({ path: decodedLink(path), note: activePath });
  return `/api/file?${query.toString()}${fragment.startsWith("#") ? fragment : ""}`;
}

export function wikiLinkHtml(embed: boolean, body: string, context: MarkdownContext) {
  const separator = body.indexOf("|");
  const target = (separator >= 0 ? body.slice(0, separator) : body).trim();
  const option = (separator >= 0 ? body.slice(separator + 1) : "").trim();
  const original = `${embed ? "!" : ""}[[${body}]]`;
  const originalAttribute = escapeAttribute(encodeSource(original));
  const extension = extensionOfLink(target);
  const fileUrl = escapeAttribute(vaultFileUrl(target, context.activePath));
  const notePath = resolveNotePath(target, context);
  const folderPath = resolveFolderPath(target, context);
  const label = escapeCode(option || titleOf(splitLinkTarget(target).path) || target);

  if (embed && IMAGE_EXTENSIONS.has(extension)) {
    const size = /^(\d+)(?:x(\d+))?$/.exec(option);
    const width = size?.[1] ? ` width="${size[1]}"` : "";
    const height = size?.[2] ? ` height="${size[2]}"` : "";
    return `<img class="pm-embed-image" src="${fileUrl}" alt="${escapeAttribute(titleOf(target))}"${width}${height} data-pm-target="${escapeAttribute(splitLinkTarget(target).path)}" data-pm-original="${originalAttribute}" contenteditable="false">`;
  }
  if (embed && AUDIO_EXTENSIONS.has(extension) && !(extension === "webm" && VIDEO_EXTENSIONS.has(extension))) {
    return `<audio class="pm-embed-audio" controls preload="metadata" src="${fileUrl}" data-pm-original="${originalAttribute}" contenteditable="false"></audio>`;
  }
  if (embed && VIDEO_EXTENSIONS.has(extension)) {
    return `<video class="pm-embed-video" controls preload="metadata" src="${fileUrl}" data-pm-original="${originalAttribute}" contenteditable="false"></video>`;
  }
  if (embed && extension === "pdf") {
    return `<iframe class="pm-embed-pdf" src="${fileUrl}" loading="lazy" title="${escapeAttribute(label)}" data-pm-original="${originalAttribute}" contenteditable="false"></iframe>`;
  }
  if (embed && notePath) {
    return `<section class="pm-note-embed" data-pm-embed-note="${escapeAttribute(notePath)}" data-pm-original="${originalAttribute}" contenteditable="false"><span>Carregando ${escapeCode(titleOf(notePath))}…</span></section>`;
  }
  if (notePath) return `<span class="pm-wikilink-wrap" data-pm-original="${originalAttribute}"><a href="#" class="pm-wikilink" data-pm-note="${escapeAttribute(notePath)}" title="Clique para abrir · passe o mouse para visualizar">${label}</a></span>`;
  if (folderPath) return `<a href="#" class="pm-wikilink pm-folder-link" data-pm-folder="${escapeAttribute(folderPath)}" data-pm-original="${originalAttribute}">${label}</a>`;
  if (extension) return `<a href="${fileUrl}" class="pm-wikilink pm-file-link" target="_blank" rel="noopener" data-pm-original="${originalAttribute}">${label}</a>`;
  const unresolvedBase = normalizeLinkPath(target).replace(/\.md$/i, "");
  const unresolved = `${target.includes("/") ? unresolvedBase : normalizeLinkPath(joinPath(parentOf(context.activePath), unresolvedBase))}.md`;
  return `<a href="#" class="pm-wikilink pm-wikilink--missing" data-pm-create="${escapeAttribute(unresolved)}" data-pm-original="${originalAttribute}">${label}</a>`;
}

export function markdownLinkHtml(image: boolean, label: string, target: string, context: MarkdownContext, original: string) {
  if (/^(?:https?:|mailto:|data:|#|\/uploads\/|\/assets\/|\/api\/)/i.test(target)) return original;
  const extension = extensionOfLink(target);
  const fileUrl = escapeAttribute(vaultFileUrl(target, context.activePath));
  const originalAttribute = escapeAttribute(encodeSource(original));
  if (image) return `<img class="pm-embed-image" src="${fileUrl}" alt="${escapeAttribute(label)}" data-pm-target="${escapeAttribute(splitLinkTarget(target).path)}" data-pm-original="${originalAttribute}" contenteditable="false">`;
  const notePath = extension === "md" ? resolveNotePath(target, context) : "";
  const folderPath = !extension ? resolveFolderPath(target, context) : "";
  if (notePath) return `<a href="#" class="pm-wikilink" data-pm-note="${escapeAttribute(notePath)}" data-pm-original="${originalAttribute}" title="Clique para abrir · passe o mouse para visualizar">${escapeCode(label)}</a>`;
  if (folderPath) return `<a href="#" data-pm-folder="${escapeAttribute(folderPath)}" data-pm-original="${originalAttribute}">${escapeCode(label)}</a>`;
  return `<a href="${fileUrl}" target="_blank" rel="noopener" data-pm-original="${originalAttribute}">${escapeCode(label)}</a>`;
}

export function transformObsidianInline(value: string, context: MarkdownContext) {
  return value
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (original, label: string, target: string) => markdownLinkHtml(true, label, target.trim().replace(/^<|>$/g, ""), context, original))
    .replace(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g, (original, label: string, target: string) => markdownLinkHtml(false, label, target.trim().replace(/^<|>$/g, ""), context, original))
    .replace(/(!)?\[\[([^\]\n]+)\]\]/g, (_original, embed: string | undefined, body: string) => wikiLinkHtml(Boolean(embed), body, context))
    .replace(/%%[\s\S]*?%%/g, "")
    .replace(/==([^=\n]+)==/g, "<mark>$1</mark>");
}

export function frontmatterHtml(source: string) {
  let parsed: unknown;
  try { parsed = parseYaml(source); }
  catch { parsed = null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return `<pre data-language="PROPRIEDADES"><code>${escapeCode(source)}</code></pre>`;
  const rows = Object.entries(parsed as Record<string, unknown>).map(([key, value]) => {
    const values = Array.isArray(value) ? value : [value];
    const rendered = values.map((item) => `<span>${escapeCode(item instanceof Date ? item.toISOString().slice(0, 10) : String(item ?? ""))}</span>`).join("");
    return `<div class="pm-property"><strong>${escapeCode(key)}</strong><div>${rendered || "<span>—</span>"}</div></div>`;
  }).join("");
  return `<section class="pm-properties" data-pm-original="${escapeAttribute(encodeSource(`---\n${source}\n---`))}" contenteditable="false"><header>PROPRIEDADES</header>${rows}</section>`;
}

export function prepareObsidianMarkdown(markdown: string, context: MarkdownContext) {
  let body = markdown;
  let properties = "";
  const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(body);
  if (frontmatter) {
    properties = `${frontmatterHtml(frontmatter[1])}\n\n`;
    body = body.slice(frontmatter[0].length);
  }
  const segments = body.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g);
  return properties + segments.map((segment, segmentIndex) => {
    if (segmentIndex % 2) return segment;
    const sourceLines = segment.split("\n");
    const calloutLines: string[] = [];
    for (let index = 0; index < sourceLines.length; index += 1) {
      const standalone = /^\s*\[!([a-z0-9_-]+)\]([+-])?\s*(.*)$/i.exec(sourceLines[index]);
      if (!standalone) { calloutLines.push(sourceLines[index]); continue; }
      calloutLines.push(`> [!${standalone[1]}]${standalone[2] || ""} ${standalone[3]}`.trimEnd());
      while (index + 1 < sourceLines.length && sourceLines[index + 1].trim()) {
        index += 1;
        calloutLines.push(sourceLines[index].startsWith(">") ? sourceLines[index] : `> ${sourceLines[index]}`);
      }
    }
    const spaced = calloutLines.join("\n").replace(/\n{3,}/g, (run) => {
      const extras = Math.max(0, run.length - 2);
      return `\n\n${Array.from({ length: extras }, () => '<div class="pm-blank-line" aria-hidden="true"></div>').join("\n\n")}\n\n`;
    });
    return transformObsidianInline(spaced, context);
  }).join("");
}

export function decorateCallouts(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const quote of template.content.querySelectorAll<HTMLQuoteElement>("blockquote")) {
    const first = quote.querySelector("p");
    const match = /^\[!([a-z0-9_-]+)\]([+-])?/i.exec(first?.textContent || "");
    if (!match) continue;
    const type = match[1].toLowerCase();
    if (first) first.innerHTML = first.innerHTML.replace(/^\[![a-z0-9_-]+\][+-]?\s*/i, "");
    if (match[2]) {
      const details = document.createElement("details");
      details.className = `pm-callout pm-callout--${type}`;
      details.dataset.pmCallout = type;
      if (match[2] === "+") details.open = true;
      const summary = document.createElement("summary");
      const firstHtml = first?.innerHTML || type;
      const breakMatch = /<br\s*\/?>/i.exec(firstHtml);
      summary.innerHTML = breakMatch ? firstHtml.slice(0, breakMatch.index) : firstHtml;
      details.appendChild(summary);
      const content = document.createElement("div");
      if (first && breakMatch) {
        const remainder = document.createElement("p");
        remainder.innerHTML = firstHtml.slice(breakMatch.index + breakMatch[0].length);
        content.appendChild(remainder);
      }
      for (const child of [...quote.children].slice(1)) content.appendChild(child);
      details.appendChild(content);
      quote.replaceWith(details);
    } else {
      quote.classList.add("pm-callout", `pm-callout--${type}`);
      quote.dataset.pmCallout = type;
    }
  }
  decorateDocumentListMarkers(template.content);
  return template.innerHTML;
}

export function sanitizeMarkdown(markdown: string, context: MarkdownContext) {
  const ruledMarker = "PENTAMARK_RULED_HEADING_7F3A_";
  const prepared = prepareObsidianMarkdown(markdown, context).replace(/^-#\s+/gm, `# ${ruledMarker}`);
  const safe = DOMPurify.sanitize(marked.parse(prepared) as string, {
    ADD_TAGS: ["video", "audio", "source", "iframe", "mark", "details", "summary"],
    ADD_ATTR: ["controls", "preload", "loading", "contenteditable", "target", "rel", "width", "height", "open", "checked", "draggable", "type"],
  });
  return decorateCallouts(safe
    .replaceAll(`<h1>${ruledMarker}`, '<h1 class="pm-ruled-heading">')
    .replace(/(<input\b[^>]*?)\sdisabled(?:="")?([^>]*>)/gi, "$1$2"));
}

let mermaidRenderId = 0;
export async function renderDynamicMarkdown(root: HTMLElement, context: MarkdownContext, depth = 0) {
  for (const diagram of root.querySelectorAll<HTMLElement>(".pm-mermaid:not([data-pm-rendered])")) {
    diagram.dataset.pmRendered = "true";
    const source = decodeSource(diagram.dataset.pmSource);
    try {
      const { svg } = await mermaid.render(`pm-mermaid-${++mermaidRenderId}`, source);
      if (!diagram.isConnected) continue;
      diagram.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
    } catch (error) {
      diagram.classList.add("pm-mermaid--error");
      diagram.innerHTML = `<strong>Mermaid não conseguiu renderizar</strong><pre><code>${escapeCode(error instanceof Error ? error.message : String(error))}</code></pre>`;
    }
  }
  if (depth >= 2) return;
  for (const embed of root.querySelectorAll<HTMLElement>(".pm-note-embed:not([data-pm-rendered])")) {
    embed.dataset.pmRendered = "true";
    const notePath = embed.dataset.pmEmbedNote || "";
    if (!notePath || notePath === context.activePath) { embed.innerHTML = "<span>Referência circular ignorada</span>"; continue; }
    try {
      const note = await request<OpenNote>(`/api/note?path=${encodeURIComponent(notePath)}`);
      if (!embed.isConnected) continue;
      const nestedContext = { ...context, activePath: notePath };
      embed.innerHTML = `<header>${escapeCode(titleOf(notePath))}</header><div>${sanitizeMarkdown(note.content, nestedContext)}</div>`;
      await renderDynamicMarkdown(embed, nestedContext, depth + 1);
    } catch {
      embed.innerHTML = `<span>Não deu para carregar ${escapeCode(titleOf(notePath))}</span>`;
    }
  }
}
