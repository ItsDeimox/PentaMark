from pathlib import Path
import hashlib,json
p=Path('src/features/workspace/WorkspacePanel.tsx');s=p.read_text().replace('[data-workspace-trigger],.pm-modal-backdrop,.pm-modal','[data-workspace-trigger],.pm-workspace-scrim,.pm-modal-backdrop,.pm-modal');p.write_text(s)
p=Path('src/features/workspace/chrome.css');s=p.read_text().replace('visibility var(--pm-motion);','visibility 0s;').replace('opacity:0; visibility:hidden; pointer-events:none; }','opacity:0; visibility:hidden; pointer-events:none; transition-delay:0s,0s,var(--pm-motion); }');p.write_text(s)
p=Path('src/app/PentaMarkApp.tsx');s=p.read_text();s='import { useTreeInputFocus } from "../features/workspace/useTreeInputFocus";\n'+s
old='  useEffect(() => { if (draft) requestAnimationFrame(() => draftRef.current?.focus()); }, [draft]);\n  useEffect(() => { if (renaming) requestAnimationFrame(() => { renameRef.current?.focus(); renameRef.current?.select(); }); }, [renaming?.path]);'
assert s.count(old)==1
s=s.replace(old,'  useTreeInputFocus(draftRef, draft ? `${draft.kind}:${draft.parent}` : "");\n  useTreeInputFocus(renameRef, renaming?.path || "", true);');p.write_text(s)
for name in ['package.json','package-lock.json']:
    p=Path(name);j=json.loads(p.read_text());j['version']='2.9.0'
    if name=='package-lock.json':j['packages']['']['version']='2.9.0'
    p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
for name in ['src/app/PentaMarkApp.tsx','scripts/build-mobile-host.mjs','LEIA-ME-Desktop.md','mobile/LEIA-ME.md','README.md']:
    p=Path(name);p.write_text(p.read_text().replace('2.8.0','2.9.0'))
for name,sha in {
    'src/app/PentaMarkApp.tsx':'5046e3ba59ec2f5064ad371fb10508d0671826b2fc96de0864dc4891a9704018',
    'src/features/workspace/WorkspacePanel.tsx':'5a48104226b68421b92b51e3a5f6921bc6c9d29f3c22b6cbf9be11cc6fc2c20e',
    'src/features/workspace/chrome.css':'cd298bf48103f43b1fd31921c6e146989036b614db10137f962e3829cf56de9e',
    'src/features/workspace/useTreeInputFocus.ts':'d005f64f22dd26ac9a7bcd46842a9499ef82544cb5501243126446eecbeab6d1'
}.items():
    assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==sha,name
