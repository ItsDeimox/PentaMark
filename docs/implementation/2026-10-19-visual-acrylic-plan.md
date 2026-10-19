# Visual refinements and acrylic material implementation plan

> Execute inline, with fixture-based regression tests before implementation.

Goal: cohesive compact sci-fi workspace; no layout substitution when editing advanced blocks.
Architecture: preserve local host, Markdown renderer and editor state. Replace workspace chrome with independent components and a shared token contract. Advanced block source editing is an overlay outside CodeMirror's measured layout; applying actual content edits is the only operation allowed to change block geometry.
Spec: latest user feedback on 19 October 2026 supersedes the initial guide's fixed sidebar document position and square outer panel. Inner controls remain geometric; outer panels have restrained 12px rounding. Collapse recenters the document.

## Tasks
- [x] Reproduce: callout focus shifts following heading by 73.9375px in Chromium CI. New visual acceptance tests fail on 2.8.0.
- [ ] Replace source-reveal/padding compensation with persistent widgets and a guarded block-source overlay; preserve undo, permissions and stale-content protection.
- [ ] Replace the tools panel, compact/animate tree, persistent brand/opener, scrolling fade, shared colors and checkbox metrics.
- [ ] Add acrylic/flat graphic modes, using a single demand-driven WebGL layer with bounded resolution, scissored panel draws, context loss recovery and CSS fallback.
- [ ] Anchor recursive previews by link bounds instead of pointer coordinates. Keep ancestor cards, cancel stale requests and bound depth.
- [ ] Validate old and new behavior, inspect actual screenshots and package the updated Windows app.

## Implementation files
- editor/live-preview/BlockSourceEditor.tsx: source overlay and guard messages.
- editor/LivePreviewEditor.tsx, decorations.ts, widgets.ts: persistent measured widgets and stable refresh signatures.
- workspace/ToolsPanel.tsx: grouped commands, view and material selection, existing action callbacks.
- workspace/AnimatedDisclosure.tsx: interruptible folder animation and inert hidden children.
- workspace/AcrylicLayer.tsx, acrylic-shader.ts: single renderer/material, no DOM snapshots or copied game assets.
- workspace/LinkPreviewStack.tsx: anchored cards, independent lifecycle and fetch state.
- workspace/chrome.css: new tokens/composition/panels. Replaces approved-workspace.css, not another appended theme.

## Review focus
1. External or concurrent edits while a source overlay is open must not overwrite a stale range or a different note.
2. WebGL failure must keep readable controls; flat mode must allocate no canvas or render loop.
3. Nested previews must preserve parents and ignore stale async completions.
4. Touch, keyboard, reduced-motion and scaled UI must retain access to all commands.
5. Any observed layout change from actual content edits must not be misrepresented as a focus-only jump.

## Reference
Read cortex-idle/src/rendering/postprocessing/modal-glass.js (blob 3873cf56247ac704e6268019ff9a92622752ba54): viewport-aligned material, rounded/cut panel bounds, scene refraction and soft blur, subtle surface texture, restrained cyan edge. PentaMark has a DOM document rather than a WebGL world. Its shader refracts its procedural optical backing; CSS backdrop blur handles the DOM behind panels. No claim that WebGL directly samples arbitrary DOM text.

## Verification environment
Container TypeScript/build works. Managed Chromium blocks navigation by administrator policy; do not change that policy. Real-host browser tests and captures run in the isolated GitHub Actions runner.
