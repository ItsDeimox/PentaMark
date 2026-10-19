"""One-time, scoped source edits for the glass refinement. No network or vault access."""
from pathlib import Path
import hashlib, json, re

def edit(name, replacements):
    path=Path(name); source=path.read_text()
    for old,new in replacements:
        assert source.count(old)==1, (name,old,source.count(old))
        source=source.replace(old,new)
    path.write_text(source)

p=Path('src/app/PentaMarkApp.tsx'); raw=p.read_bytes()
assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()=='55f0b26e3a33b86100dc6a0e87ce56ec97580922'
edit(str(p),[
 ('            onDoubleClick={() => startRename("note", note.path)}\n',''),
 ('            onDoubleClick={() => !root && startRename("folder", path)}\n',''),
])
p=Path('src/features/workspace/ToolsPanel.tsx');s=p.read_text()
s,n=re.subn(r'<p className="pm-material-hint">.*?</p>','',s,flags=re.S);assert n==1
s=s.replace('>MATERIAL</div>','>GRÁFICOS</div>');p.write_text(s)
p=Path('src/components/dialogs/SettingsModal.tsx');s=p.read_text()
s=s.replace(' subtitle="Um espaço de trabalho com a sua identidade."','')
s=s.replace('title="Material dos painéis" hint="Acabamento visual independente da cor do tema."','title="Gráficos"')
s=s.replace(' hint="O mesmo tom percorre o vidro, os controles e os detalhes de luz."','')
s=s.replace(' hint="Interface e documento podem ter personalidades diferentes."','')
s=s.replace('<small>Fosco e direto.<br/>Consumo mínimo.</small>','').replace('<small>Vidro e microtextura.<br/>Circuitos sob a luz.</small>','')
s,n=re.subn(r'^\s*<div className="pm-material-demo"[^\n]*\n','\n',s,flags=re.M);assert n==1
s,n=re.subn(r'^\s*<p className="pm-field-hint">O acrílico usa WebGL[^\n]*\n','\n',s,flags=re.M);assert n==1
p.write_text(s)
edit('src/components/dialogs/ProfileModal.tsx',[
 (' subtitle="Sua identidade nos cofres compartilhados."',''),
 ('<span className="pm-dialog-eyebrow">PRÉVIA DO PERFIL</span>',''),
 ('<small>Visível para as pessoas conectadas ao cofre.</small>',''),
 ('Este perfil é local. Ele identifica suas sessões e edições, sem criar uma conta na nuvem.','Perfil salvo neste dispositivo. Não cria uma conta na nuvem.'),
])
edit('src/components/dialogs/DialogFrame.tsx',[
 ("eyebrow = 'PENTAMARK'","eyebrow = ''"),
 ('<span className="pm-dialog-eyebrow">{eyebrow}</span>','{eyebrow && <span className="pm-dialog-eyebrow">{eyebrow}</span>}'),
])
# Nested profile and hovered controls now own a backing too: validate the dialog's
# direct surface instead of incorrectly requiring one canvas in its entire subtree.
for name in ['tests/acrylic-dialogs.spec.mjs']:
    p=Path(name);s=p.read_text();old="dialog.locator('.pm-acrylic-pane')";assert old in s
    p.write_text(s.replace(old,"dialog.locator('.pm-dialog > .pm-acrylic-pane')"))
for name in ['package.json','package-lock.json']:
    p=Path(name);j=json.loads(p.read_text());j['version']='2.11.0'
    if name=='package-lock.json':j['packages']['']['version']='2.11.0'
    p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
for name in ['README.md','LEIA-ME-Desktop.md','mobile/LEIA-ME.md']:
    p=Path(name);p.write_text(p.read_text().replace('2.10.0','2.11.0'))
print('Applied only declared UI edits; dependencies and vault code unchanged.')
