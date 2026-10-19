from pathlib import Path
import subprocess
root=Path.cwd()
p=root/'src/features/editor/live-preview/decorations.ts'
s=p.read_text()
s=s.replace('  active: boolean,\n) {\n  for (const marker of markers) {\n    if (active) mark(ranges, marker.from, marker.to, "pm-live-syntax");\n    else hide(ranges, marker.from, marker.to);\n  }\n}', '''  _active: boolean,
) {
  // Inline source markers never enter measured text geometry on focus.
  // Complete syntax remains editable in the explicit Markdown source mode.
  for (const marker of markers) hide(ranges, marker.from, marker.to);
}''')
s=s.replace('    if (active(from, to)) mark(ranges, from, to, "pm-live-comment");\n    else hide(ranges, from, to);','    hide(ranges, from, to);')
s=s.replace('          if (lineActive) mark(ranges, markerFrom, markerTo, "pm-live-syntax pm-live-block-syntax");\n          else hide(ranges, markerFrom, markerTo);','          hide(ranges, markerFrom, markerTo);')
s=s.replace('            if (lineActive) mark(ranges, markerFrom, prefixTo, "pm-live-syntax pm-live-block-syntax");\n            else ranges.push(Decoration.replace({','            ranges.push(Decoration.replace({')
s=s.replace('            if (lineActive) {\n              mark(ranges, markerFrom, markerTo, "pm-live-syntax pm-live-block-syntax");\n            } else if (/^[-+*]$/.test(list[2])) {','            if (/^[-+*]$/.test(list[2])) {')
p.write_text(s)
p=root/'src/features/workspace/WorkspacePanel.tsx';s=p.read_text()
s=s.replace('    document.addEventListener("pointerdown", outside);\n    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", outside); };','''    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (event.target as HTMLElement)?.closest?.(".pm-modal-backdrop,.pm-modal")) return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
      requestAnimationFrame(() => {
        if (restore.current?.isConnected && !restore.current.closest("[inert]")) restore.current.focus({ preventScroll: true });
      });
    };
    document.addEventListener("pointerdown", outside);
    // Capture Escape even during the opening frame, before focus reaches the panel.
    document.addEventListener("keydown", escape, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); };''')
s=s.replace('        // Source fields must not invoke the underlying editor\'s formatting handlers.\n        event.stopPropagation();\n','')
p.write_text(s)
p=root/'src/features/workspace/approved-workspace.css';s=p.read_text().replace('.pm-note-item.active','.pm-note-item--active').replace('.pm-note-item:hover:not(.active)','.pm-note-item:hover:not(.pm-note-item--active)')
s=s.replace('height: 33px; filter: none; background: var(--pm-text);','height: 33px; filter: none; background: transparent;')
s=s.replace('.pm-shell[data-theme] .pm-mark span { background: var(--pm-panel); }','.pm-shell[data-theme] .pm-mark:before { width: 32px; height: 32px; background: var(--pm-text); }\n.pm-shell[data-theme] .pm-mark:after { width: 26px; height: 26px; background: var(--pm-panel); }\n.pm-shell[data-theme] .pm-mark span { display: none; }')
s=s.replace('.pm-shell[data-theme] .pm-note-item strong { font-weight: 400; }','.pm-shell[data-theme] .pm-note-item strong { font-size: 1em; font-weight: 400; color: inherit; }\n.pm-shell[data-theme] .pm-note-item > span:first-of-type { flex: 1; min-width: 0; font-size: 1em; }\n.pm-shell[data-theme] .pm-folder-title { font-weight: 400; }\n.pm-sidebar-collapse svg { transform: rotate(180deg); }')
s=s.replace('{ transition: none; animation: none; }','{ transition: none !important; animation: none !important; }')
s=s.replace('width: min(var(--pm-sidebar-width), calc(100% - 2 * var(--pm-frame-gap))); z-index: 160;', 'width: min(440px, calc(100% - 2 * var(--pm-frame-gap))); z-index: 160;')
p.write_text(s)
expected={'src/features/editor/live-preview/decorations.ts':'d7e2bb6cd5e228f1c640da09eec6fccf4ebc85c2','src/features/workspace/WorkspacePanel.tsx':'12263b99adb7feaa691860d140012753b12d5820','src/features/workspace/approved-workspace.css':'c8527dcb33f8af3b39762e85828405d889b46e07'}
for name,sha in expected.items():
    actual=subprocess.check_output(['git','hash-object',name],text=True).strip()
    assert actual==sha, (name,actual)
