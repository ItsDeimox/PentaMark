import { ACRYLIC_FRAGMENT, ACRYLIC_VERTEX } from './acrylic-shader';

const CHROME = '.pm-sidebar,.pm-workspace-panel,.pm-modal,.pm-context-menu,.pm-link-hover-preview,.pm-selection-tools,.pm-asset-workspace>header,.pm-asset-workspace>footer,.pm-lock-banner,.pm-toast,.pm-mobile-dock';
const DOCUMENT = '.pm-callout,.pm-properties,.pm-kanban,.pm-markdown pre';
const SURFACES = `${CHROME},${DOCUMENT}`;
const MAX_TARGETS = 20;
const BACKING_BUDGET = 8_000_000;
const SCRATCH_BUDGET = 2_000_000;
type Geometry = { x: number; y: number; scale: number; width: number; height: number; left: number; top: number; cropWidth: number; cropHeight: number; radius: number };
type Target = { pane: HTMLCanvasElement; ctx: CanvasRenderingContext2D; geometry: Geometry; density: number; dirty: boolean; hover: number; pointer: [number, number]; paints: number; quiet: boolean };

/** Cached per-surface backing, one bounded GPU scratch buffer. Pointer movement
 * only repaints the active surface and a previous surface's short fade-out. */
export function attachAcrylicRenderer(canvas: HTMLCanvasElement, shell: HTMLElement): () => void {
  let gl: WebGLRenderingContext | null = null;
  try { gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'low-power' }); } catch { /* Native acrylic remains available. */ }
  const fallback = () => { canvas.dataset.renderer = 'fallback'; shell.dataset.gl = 'fallback'; };
  if (!gl) { fallback(); return () => { delete shell.dataset.gl; }; }
  const context = gl;
  let program: WebGLProgram | null = null, buffer: WebGLBuffer | null = null;
  let frame = 0, stopped = false, lost = false, registryDirty = true, layoutDirty = true;
  let movingUntil = 0, previousTime = 0, draws = 0;
  let active: HTMLElement | null = null;
  let cursor: [number, number] = [-10000, -10000];
  const targets = new Map<HTMLElement, Target>();
  let candidates: HTMLElement[] = [];
  const intersecting = new Set<Element>();
  const uniforms = new Map<string, WebGLUniformLocation | null>();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const uniform = (name: string) => uniforms.get(name) ?? null;
  const accentHex = getComputedStyle(shell).getPropertyValue('--pm-accent-base').trim().replace('#', '');
  const accent = /^[0-9a-f]{6}$/i.test(accentHex) ? [0, 2, 4].map(i => parseInt(accentHex.slice(i, i + 2), 16) / 255) : [.47, .82, .86];

  function initialize() {
    const shaders: WebGLShader[] = [];
    try {
      program = context.createProgram(); if (!program) throw new Error('Program allocation');
      for (const [type, source] of [[context.VERTEX_SHADER, ACRYLIC_VERTEX], [context.FRAGMENT_SHADER, ACRYLIC_FRAGMENT]] as const) {
        const shader = context.createShader(type); if (!shader) throw new Error('Shader allocation');
        shaders.push(shader); context.shaderSource(shader, source); context.compileShader(shader);
        if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) throw new Error(context.getShaderInfoLog(shader) || 'Shader compilation');
        context.attachShader(program, shader);
      }
      context.linkProgram(program);
      if (!context.getProgramParameter(program, context.LINK_STATUS)) throw new Error(context.getProgramInfoLog(program) || 'Material link');
      context.useProgram(program); buffer = context.createBuffer(); if (!buffer) throw new Error('Buffer allocation');
      context.bindBuffer(context.ARRAY_BUFFER, buffer);
      context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), context.STATIC_DRAW);
      const position = context.getAttribLocation(program, 'aPosition');
      context.enableVertexAttribArray(position); context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0);
      for (const name of ['uSize','uCrop','uBuffer','uOrigin','uViewport','uPointer','uAccent','uDensity','uRadius','uHover','uQuiet']) uniforms.set(name, context.getUniformLocation(program, name));
      context.uniform3f(uniform('uAccent'), accent[0], accent[1], accent[2]);
      canvas.dataset.renderer = 'webgl'; shell.dataset.gl = 'webgl';
    } finally { shaders.forEach(shader => context.deleteShader(shader)); }
  }
  function invalidate() {
    if (!frame && !stopped && !lost && !document.hidden) {
      previousTime = performance.now(); frame = requestAnimationFrame(render);
    }
  }
  const resized = new ResizeObserver(() => { layoutDirty = true; invalidate(); });
  const intersections = new IntersectionObserver(entries => {
    entries.forEach(entry => entry.isIntersecting ? intersecting.add(entry.target) : intersecting.delete(entry.target));
    layoutDirty = true; invalidate();
  });
  function release(panel: HTMLElement, target: Target) {
    target.pane.remove(); target.pane.width = target.pane.height = 1;
    panel.classList.remove('pm-material-host'); delete panel.dataset.surface; targets.delete(panel);
  }
  function collect() {
    registryDirty = false; resized.disconnect(); intersections.disconnect(); intersecting.clear();
    candidates = Array.from(shell.querySelectorAll<HTMLElement>(SURFACES)).filter(panel =>
      !panel.matches(DOCUMENT) || !panel.parentElement?.closest(DOCUMENT));
    // A modal's surface always has priority over document decorations.
    candidates.sort((a, b) => Number(b.matches('.pm-modal')) - Number(a.matches('.pm-modal')) || Number(a.matches(DOCUMENT)) - Number(b.matches(DOCUMENT)));
    resized.observe(shell);
    candidates.forEach(panel => { resized.observe(panel); intersections.observe(panel); intersecting.add(panel); });
    const topDialog = Array.from(shell.querySelectorAll<HTMLDialogElement>('dialog[open]')).at(-1);
    if (topDialog && active && !topDialog.contains(active)) active = null;
    layoutDirty = true;
  }
  function measure() {
    layoutDirty = false;
    const visible: Array<[HTMLElement, Geometry]> = [];
    for (const panel of candidates) {
      if (!panel.isConnected || !intersecting.has(panel)) continue;
      const rect = panel.getBoundingClientRect(), style = getComputedStyle(panel);
      if (rect.width < 2 || rect.height < 2 || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < .01 || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) continue;
      const scale = rect.width / Math.max(1, panel.offsetWidth);
      const x = rect.left + panel.clientLeft * scale, y = rect.top + panel.clientTop * scale;
      const width = panel.clientWidth, height = panel.clientHeight;
      const left = Math.max(0, -x / scale), top = Math.max(0, -y / scale);
      const cropWidth = Math.min(width - left, (innerWidth - Math.max(0, x)) / scale);
      const cropHeight = Math.min(height - top, (innerHeight - Math.max(0, y)) / scale);
      if (cropWidth < 1 || cropHeight < 1) continue;
      visible.push([panel, { x, y, scale, width, height, left, top, cropWidth, cropHeight, radius: Math.max(0, (parseFloat(style.borderRadius) || 0) - panel.clientLeft) }]);
      if (visible.length >= MAX_TARGETS) break;
    }
    const live = new Set(visible.map(([panel]) => panel));
    targets.forEach((target, panel) => { if (!live.has(panel)) release(panel, target); });
    const totalArea = visible.reduce((sum, [, g]) => sum + g.cropWidth * g.cropHeight * g.scale * g.scale, 0);
    const budgetDensity = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(BACKING_BUDGET / Math.max(1, totalArea)));
    for (const [panel, g] of visible) {
      const density = Math.min(budgetDensity * g.scale, Math.sqrt(SCRATCH_BUDGET / (g.cropWidth * g.cropHeight)), 2048 / Math.max(g.cropWidth, g.cropHeight));
      let target = targets.get(panel);
      if (!target) {
        const pane = document.createElement('canvas'); pane.className = 'pm-acrylic-pane'; pane.setAttribute('aria-hidden', 'true'); pane.dataset.circuit = 'true';
        const ctx = pane.getContext('2d'); if (!ctx) continue;
        const quiet = panel.matches(DOCUMENT);
        panel.prepend(pane); panel.classList.add('pm-material-host'); panel.dataset.surface = quiet ? 'document' : 'chrome';
        target = { pane, ctx, geometry: g, density, dirty: true, hover: 0, pointer: [-10000,-10000], paints: 0, quiet };
        targets.set(panel, target);
      } else {
        if (density !== target.density || Object.keys(g).some(key => Math.abs(g[key as keyof Geometry] - target!.geometry[key as keyof Geometry]) > .1)) target.dirty = true;
        target.geometry = g; target.density = density;
      }
      // Scrollable surfaces keep their backing pinned to the visible panel.
      target.pane.style.cssText = `left:${g.left}px;top:${panel.scrollTop + g.top}px;width:${g.cropWidth}px;height:${g.cropHeight}px;`;
    }
    canvas.dataset.surfaces = String(targets.size);
  }
  function render(now: number) {
    frame = 0; if (stopped || lost || document.hidden || !program) return;
    if (registryDirty) collect();
    if (layoutDirty || now < movingUntil) measure();
    const delta = Math.min(32, Math.max(1, now - previousTime)); previousTime = now;
    let animate = now < movingUntil;
    for (const [panel, target] of targets) {
      const desired = panel === active ? 1 : 0;
      if (Math.abs(target.hover - desired) > .005) {
        target.hover = reduced.matches ? desired : target.hover + (desired - target.hover) * (1 - Math.exp(-delta / 45));
        if (Math.abs(target.hover - desired) <= .005) target.hover = desired;
        target.dirty = true; animate ||= target.hover !== desired;
      }
      if (panel === active) {
        const g = target.geometry;
        const point: [number, number] = [(cursor[0] - g.x) / g.scale, (cursor[1] - g.y) / g.scale];
        if (Math.abs(target.pointer[0] - point[0]) + Math.abs(target.pointer[1] - point[1]) > .2) { target.pointer = point; target.dirty = true; }
      }
      if (!target.dirty) continue;
      const g = target.geometry, density = target.density;
      const width = Math.max(1, Math.floor(g.cropWidth * density)), height = Math.max(1, Math.floor(g.cropHeight * density));
      if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height;
      context.viewport(0,0,width,height); context.clearColor(0,0,0,0); context.clear(context.COLOR_BUFFER_BIT);
      context.uniform2f(uniform('uSize'), g.width, g.height); context.uniform2f(uniform('uCrop'), g.left, g.top);
      context.uniform2f(uniform('uBuffer'), width, height); context.uniform2f(uniform('uOrigin'), g.x / g.scale, g.y / g.scale);
      context.uniform2f(uniform('uViewport'), innerWidth / g.scale, innerHeight / g.scale);
      context.uniform2f(uniform('uPointer'), ...target.pointer); context.uniform1f(uniform('uDensity'), density);
      context.uniform1f(uniform('uRadius'), Math.min(g.radius, g.width / 2, g.height / 2));
      context.uniform1f(uniform('uHover'), target.hover); context.uniform1f(uniform('uQuiet'), target.quiet ? 1 : 0);
      context.drawArrays(context.TRIANGLES, 0, 6);
      if (target.pane.width !== width) target.pane.width = width; if (target.pane.height !== height) target.pane.height = height;
      target.ctx.clearRect(0,0,width,height); target.ctx.drawImage(canvas,0,0);
      target.pane.dataset.paints = String(++target.paints); target.dirty = false;
      canvas.dataset.draws = String(++draws);
    }
    canvas.dataset.backingPixels = String(Array.from(targets.values()).reduce((sum, t) => sum + t.pane.width * t.pane.height, 0));
    if (animate) frame = requestAnimationFrame(render);
  }
  const internal = (node: Node) => node === canvas || (node instanceof Element && node.matches('.pm-acrylic-pane'));
  const changed = new MutationObserver(records => {
    let registry = false, layout = false;
    for (const record of records) {
      if (internal(record.target)) continue;
      if (record.type === 'attributes') {
        const element = record.target as Element;
        if (record.attributeName === 'class' && (record.oldValue || '').replace(/\bpm-material-host\b/g,'').trim() === element.className.toString().replace(/\bpm-material-host\b/g,'').trim()) continue;
        if (element === shell || element.matches(`${SURFACES},dialog`)) layout = true;
      } else if ([...record.addedNodes,...record.removedNodes].some(node => !internal(node) && node instanceof Element && (node.matches(SURFACES) || node.querySelector(SURFACES)))) registry = true;
    }
    registryDirty ||= registry; layoutDirty ||= layout;
    if (registry || layout) invalidate();
  });
  const pointer = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    let panel = event.target instanceof Element ? event.target.closest<HTMLElement>(SURFACES) : null;
    while (panel && !candidates.includes(panel)) panel = panel.parentElement?.closest<HTMLElement>(SURFACES) || null;
    if (!panel && !active) return;
    if (panel === active && Math.abs(event.clientX - cursor[0]) + Math.abs(event.clientY - cursor[1]) < .2) return;
    active = panel; cursor = [event.clientX,event.clientY]; invalidate();
  };
  const leave = () => { if (active) { active = null; invalidate(); } };
  const layout = () => { layoutDirty = true; invalidate(); };
  const moving = (event: Event) => {
    if (event.target instanceof Element && event.target.matches(`${SURFACES},.pm-dialog-layer`)) {
      movingUntil = performance.now() + (reduced.matches ? 0 : 230); layout();
    }
  };
  const visibility = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; active = null; } else { targets.forEach(t => t.dirty = true); layout(); } };
  const onLost = (event: Event) => { event.preventDefault(); lost = true; cancelAnimationFrame(frame); frame = 0; fallback(); };
  const restored = () => {
    lost = false; program = null; buffer = null; uniforms.clear();
    try { initialize(); targets.forEach(t => t.dirty = true); registryDirty = true; layout(); } catch { lost = true; fallback(); }
  };
  try { initialize(); } catch (error) {
    if (buffer) context.deleteBuffer(buffer); if (program) context.deleteProgram(program);
    fallback(); console.warn('Acrílico nativo: material WebGL indisponível.', error);
    return () => { resized.disconnect(); intersections.disconnect(); delete shell.dataset.gl; };
  }
  changed.observe(shell, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class','style','open','data-entered','data-visible'] });
  shell.addEventListener('pointermove', pointer, { passive: true }); shell.addEventListener('pointerleave', leave);
  shell.addEventListener('scroll', layout, true); shell.addEventListener('transitionrun', moving); shell.addEventListener('animationstart', moving);
  shell.addEventListener('transitionend', layout); window.addEventListener('resize', layout); window.addEventListener('blur', leave);
  document.addEventListener('visibilitychange', visibility); reduced.addEventListener('change', layout);
  canvas.addEventListener('webglcontextlost', onLost); canvas.addEventListener('webglcontextrestored', restored);
  invalidate();
  return () => {
    stopped = true; cancelAnimationFrame(frame); changed.disconnect(); resized.disconnect(); intersections.disconnect();
    targets.forEach((target, panel) => release(panel,target));
    shell.removeEventListener('pointermove', pointer); shell.removeEventListener('pointerleave', leave); shell.removeEventListener('scroll', layout, true);
    shell.removeEventListener('transitionrun', moving); shell.removeEventListener('animationstart', moving); shell.removeEventListener('transitionend', layout);
    window.removeEventListener('resize', layout); window.removeEventListener('blur', leave); document.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', layout);
    canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', restored);
    if (!lost) { if (buffer) context.deleteBuffer(buffer); if (program) context.deleteProgram(program); }
    canvas.width = canvas.height = 1; delete shell.dataset.gl;
  };
}
