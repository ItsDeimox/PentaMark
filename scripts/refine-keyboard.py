from pathlib import Path
import subprocess
root=Path.cwd()
p=root/'src/app/PentaMarkApp.tsx';s=p.read_text()
s=s.replace('    ...DOCUMENT_STYLE_VARIABLES,\n    ...DOCUMENT_STYLE_VARIABLES,','    ...DOCUMENT_STYLE_VARIABLES,')
s=s.replace('    setToolsOpen(false);\n    expandParents(parent);','    setToolsOpen(false);\n    setQuickOpen(false);\n    setQuery("");\n    expandParents(parent);')
s=s.replace('    setRenaming({ kind, path, value: kind === "note" ? titleOf(path) : baseName(path) });\n  }, []);','    setRenaming({ kind, path, value: kind === "note" ? titleOf(path) : baseName(path) });\n    setSidebarOpen(true);\n    setMobileSidebar(true);\n    setToolsOpen(false);\n    setQuickOpen(false);\n    expandParents(parentOf(path));\n  }, [expandParents]);')
s=s.replace('    const shortcuts = (event: KeyboardEvent) => {\n      if (!(event.ctrlKey || event.metaKey)) return;','    const shortcuts = (event: KeyboardEvent) => {\n      if (event.key === "Escape") { setQuickOpen(false); setToolsOpen(false); return; }\n      if (!(event.ctrlKey || event.metaKey)) return;')
s=s.replace('      if (key === "b" && document.activeElement !== textareaRef.current && !editingLive)', '      const editingField = document.activeElement instanceof HTMLElement && document.activeElement.matches("input,textarea,select,[contenteditable=\'true\']");\n      if (key === "b" && !editingField && !editingLive)')
p.write_text(s)
p=root/'src/features/editor/LivePreviewEditor.tsx';s=p.read_text()
s=s.replace('historyKeymap } from "@codemirror/commands"','historyKeymap, redo } from "@codemirror/commands"')
s=s.replace('keymap.of([...defaultKeymap, ...historyKeymap])','keymap.of([{ key: "Mod-Shift-z", run: redo, preventDefault: true }, ...defaultKeymap, ...historyKeymap])')
s=s.replace('        applyFormat(kind) {\n          const transaction', '        applyFormat(kind) {\n          if (propsRef.current.readOnly || view!.state.readOnly) return;\n          const transaction')
p.write_text(s)
for name,sha in {'src/app/PentaMarkApp.tsx':'985a996a7a2634856716f9358710a10217fd16e4','src/features/editor/LivePreviewEditor.tsx':'ff59566ee1d23e92d66d5b6e0b927ed4e500a8c8'}.items():
    actual=subprocess.check_output(['git','hash-object',name],text=True).strip()
    assert actual==sha, (name,actual)
