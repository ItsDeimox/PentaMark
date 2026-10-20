import DOMPurify from "dompurify";
import mermaid from "mermaid";
import { decodeSource, escapeCode } from "../../shared/text";

type Palette = { background: string; surface: string; text: string; accent: string; muted: string; light: boolean };
type Result = { svg: string; error?: string };
type Job = { promise: Promise<Result>; consumers: Set<() => boolean> };
const cache = new Map<string, Result>();
const jobs = new Map<string, Job>();
const states = new WeakMap<HTMLElement, { key: string; promise: Promise<void> }>();
const themeWatches = new WeakMap<Element, Set<WeakRef<HTMLElement>>>();
const palettes = new Map<string, Palette>();
let colorContext: CanvasRenderingContext2D | null | undefined;
let cacheSize = 0;
let sequence = 0;
let queue: Promise<unknown> = Promise.resolve();

function paletteFor(element: HTMLElement): Palette {
  const style = getComputedStyle(element);
  const light = element.closest("[data-theme]")?.getAttribute("data-theme") === "pearl";
  const names = ["--pm-panel", "--pm-panel-2", "--pm-text", "--pm-cyan", "--pm-muted"];
  const fallbacks = light
    ? ["#f6f9fb", "#e7eef3", "#233541", "#21677e", "#506675"]
    : ["#1b2124", "#222a2e", "#dce5e8", "#79d2dc", "#9baab0"];
  const values = names.map((name, index) => style.getPropertyValue(name).trim() || fallbacks[index]);
  const key = JSON.stringify([light, style.color, ...values]);
  const cached = palettes.get(key);
  if (cached) return cached;
  if (colorContext === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    colorContext = canvas.getContext("2d", { willReadFrequently: true });
  }
  // Computed CSS colors can still be color(srgb …), oklab(), etc. Mermaid's
  // parser needs legacy colors: rasterize to the canvas's default sRGB space
  // and read bytes rather than trusting the serialization of fillStyle.
  // Resolve in the diagram's scope so custom properties/currentColor inherit.
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  probe.setAttribute("aria-hidden", "true");
  element.appendChild(probe);
  let colors: string[];
  try {
    colors = values.map((value, index) => {
      const context = colorContext;
      if (!context) return fallbacks[index];
      probe.style.color = fallbacks[index];
      probe.style.color = value;
      const resolved = getComputedStyle(probe).color;
      // An invalid canvas color leaves fillStyle unchanged. Painting a known
      // opaque fallback first also composites transparent theme values safely.
      context.fillStyle = fallbacks[index];
      context.fillRect(0, 0, 1, 1);
      context.fillStyle = resolved;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      return `#${[r, g, b].map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
    });
  } finally { probe.remove(); }
  const palette = {
    background: colors[0], surface: colors[1], text: colors[2], accent: colors[3], muted: colors[4], light,
  };
  palettes.set(key, palette);
  if (palettes.size > 32) palettes.delete(palettes.keys().next().value!);
  return palette;
}

function remember(key: string, value: Result) {
  const size = key.length + value.svg.length + (value.error?.length || 0);
  if (size > 2_000_000) return;
  cache.set(key, value);
  cacheSize += size;
  while (cache.size > 48 || cacheSize > 2_000_000) {
    const oldest = cache.keys().next().value!;
    const result = cache.get(oldest)!;
    cacheSize -= oldest.length + result.svg.length + (result.error?.length || 0);
    cache.delete(oldest);
  }
}

function diagramResult(key: string, source: string, palette: Palette, alive: () => boolean) {
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key); cache.set(key, cached);
    return Promise.resolve(cached);
  }
  let job = jobs.get(key);
  if (!job) {
    const consumers = new Set<() => boolean>();
    // Mermaid owns global configuration. Initialize and render together in this
    // queue, so another preview cannot change the palette during an async draw.
    const promise = queue.then(async (): Promise<Result> => {
      if (![...consumers].some(consumer => consumer())) throw new DOMException("Cancelled", "AbortError");
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;width:1200px";
      host.setAttribute("aria-hidden", "true");
      document.body.appendChild(host);
      try {
        mermaid.initialize({
          startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true,
          htmlLabels: false, flowchart: { htmlLabels: false }, theme: "base", fontFamily: "monospace",
          maxTextSize: 50_000, maxEdges: 500,
          // Per-diagram init/frontmatter must not re-enable HTML labels (removed
          // by the SVG sanitizer), lower security, or override the app palette.
          secure: ["secure", "securityLevel", "startOnLoad", "suppressErrorRendering", "maxTextSize", "maxEdges", "htmlLabels", "theme", "themeVariables", "fontFamily"],
          themeVariables: {
            darkMode: !palette.light, background: palette.background,
            primaryColor: palette.surface, primaryTextColor: palette.text, primaryBorderColor: palette.accent,
            secondaryColor: palette.background, secondaryTextColor: palette.text, secondaryBorderColor: palette.muted,
            tertiaryColor: palette.surface, tertiaryTextColor: palette.text, tertiaryBorderColor: palette.accent,
            textColor: palette.text, lineColor: palette.muted, edgeLabelBackground: palette.background,
            actorBkg: palette.surface, actorTextColor: palette.text, actorBorder: palette.accent,
            signalColor: palette.text, signalTextColor: palette.text, labelTextColor: palette.text,
            noteBkgColor: palette.surface, noteTextColor: palette.text, noteBorderColor: palette.accent,
          },
        });
        if (source.length > 50_000) throw new Error("O diagrama excede o limite de 50.000 caracteres.");
        const { svg } = await mermaid.render(`pm-diagram-${++sequence}`, source, host);
        const result = { svg: DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ["foreignObject"] }) };
        remember(key, result);
        return result;
      } catch (error) {
        const result = { svg: "", error: error instanceof Error ? error.message : String(error) };
        remember(key, result);
        return result;
      } finally { host.remove(); }
    });
    queue = promise.catch(() => undefined);
    job = { promise, consumers };
    jobs.set(key, job);
    void promise.finally(() => jobs.delete(key)).catch(() => undefined);
  }
  job.consumers.add(alive);
  return job.promise.finally(() => job!.consumers.delete(alive));
}

/** Cached SVG is a template: every insertion needs its own ids and references. */
function instantiateSvg(svg: string) {
  const template = document.createElement("template");
  template.innerHTML = svg;
  const prefix = `pm-svg-${++sequence}-`;
  const ids = new Map<string, string>();
  for (const node of template.content.querySelectorAll("[id]")) {
    const old = node.id;
    const id = `${prefix}${ids.size}`;
    ids.set(old, id); node.id = id;
  }
  if (!ids.size) return template.innerHTML;
  const alternatives = [...ids.keys()].sort((a, b) => b.length - a.length).map(id => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  // CSS selectors, url(#marker), href/xlink:href, and a11y IDREF lists.
  let output = template.innerHTML.replace(new RegExp(`#(${alternatives})(?![\\w-])`, "g"), (_match, id: string) => `#${ids.get(id)}`);
  output = output.replace(/(aria-labelledby|aria-describedby)="([^"]*)"/g, (_match, attribute: string, value: string) =>
    `${attribute}="${value.split(/\s+/).map(id => ids.get(id) || id).join(" ")}"`);
  return output;
}

function watchTheme(diagram: HTMLElement) {
  const shell = diagram.closest("[data-theme]");
  if (!shell) return;
  let elements = themeWatches.get(shell);
  if (!elements) {
    elements = new Set(); themeWatches.set(shell, elements);
    const observer = new MutationObserver(() => {
      for (const reference of elements!) {
        const element = reference.deref();
        if (!element?.isConnected) elements!.delete(reference);
        else void renderMermaidDiagram(element);
      }
    });
    observer.observe(shell, { attributes: true, attributeFilter: ["data-theme"] });
  }
  for (const reference of elements) {
    const element = reference.deref();
    if (!element?.isConnected) elements.delete(reference);
    if (element === diagram) return;
  }
  elements.add(new WeakRef(diagram));
}

export function renderMermaidDiagram(diagram: HTMLElement, signal?: AbortSignal): Promise<void> {
  if (!diagram.isConnected || signal?.aborted) return Promise.resolve();
  const source = decodeSource(diagram.dataset.pmSource);
  const palette = paletteFor(diagram);
  const key = JSON.stringify(palette) + "\n" + source;
  const previous = states.get(diagram);
  if (previous?.key === key) return previous.promise;
  const alive = () => diagram.isConnected && !signal?.aborted && states.get(diagram)?.key === key;
  const promise = diagramResult(key, source, palette, alive).then(result => {
    if (!alive()) return;
    diagram.classList.toggle("pm-mermaid--error", Boolean(result.error));
    diagram.innerHTML = result.error
      ? `<strong>Mermaid não conseguiu renderizar</strong><pre><code>${escapeCode(result.error)}</code></pre>`
      : instantiateSvg(result.svg);
    diagram.dataset.pmRendered = "true";
    diagram.dispatchEvent(new Event("load"));
  }).catch(error => {
    // Cancelled queued jobs are retryable if their root becomes active again.
    if (states.get(diagram)?.promise === promise) states.delete(diagram);
    if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
  });
  states.set(diagram, { key, promise });
  watchTheme(diagram);
  return promise;
}
