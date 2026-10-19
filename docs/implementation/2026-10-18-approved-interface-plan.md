# Approved PentaMark Interface Implementation Plan

> Execute inline, task by task, with regression evidence before production changes.

**Goal:** Implement the approved square graphite document-first workspace and stable inline editing in the existing application.

**Architecture:** Preserve the existing app, Markdown renderer and shared document geometry. Add focused workspace controls and theme styling; decouple source inspection from inline layout. Do not replace persistence or collaboration.

**Tech Stack:** React, TypeScript, CodeMirror 6, Vite, Node host, Playwright/Chromium.

**Spec:** docs/implementation/approved-visual-spec.md.

## Global constraints

0px corners; #181A1B/#17191A graphite; no decorative background image; 140-200ms panels; no document geometry animation; preserve shortcuts/preferences; fixture-only tests; no automatic merge or main deployment.

## Review focus

- Collapse preserves document coordinates, selection, tree scroll and expanded paths.
- Controls remain reachable with keyboard, touch, narrow screens and application scaling.
- Formatted text near wrap boundaries does not reflow on focus or selection.
- Source edits/formatting retain undo and saving, including stale source protection.
- Every existing mode/action retains an accessible route.

## Task 1: Establish regression evidence

- [ ] Add an isolated fixture vault and browser tests against the real local host.
- [ ] Run baseline typecheck/build.
- [ ] Observe approved-layout assertions fail before changes and record any reproduced editor defect.

## Task 2: Workspace and on-demand controls

Files: src/features/workspace/*, src/app/PentaMarkApp.tsx, src/app/constants.tsx, src/main.tsx.

- [ ] Implement square graphite tokens, floating tree, opener and stable document column.
- [ ] Move permanent tools into on-demand controls, preserving actions.
- [ ] Preserve tree/selection/scroll; restore focus; honor reduced motion.
- [ ] Validate 1672x941, 1280x800, 390x844, scaled UI and saved preferences.

## Task 3: Stable inline editing

Files: src/features/editor/LivePreviewEditor.tsx, src/features/editor/live-preview/* and focused workspace components.

- [ ] Reproduce focus-induced marker reflow.
- [ ] Keep syntax inspection out of rendered geometry while preserving explicit source access.
- [ ] Exercise caret, selection, edits, undo, save and source conflicts.
- [ ] Run typecheck/build and all new tests; capture the actual UI.

## Subsequent increments

Neural map: real hierarchy, stable layout, keyboard/touch, optional bounded GLSL and hidden-view suspension. AI activity: actual MCP events/diffs and truthful states. Further regression coverage: two-client collaboration, Windows packaging and large-vault profiling.

## Delivery boundary

Report implemented/tested/pending separately. Do not claim subsequent increments finished. Keep main unchanged for review.
