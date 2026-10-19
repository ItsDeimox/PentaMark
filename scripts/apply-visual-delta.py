"""One-time, checksum-verified source transfer into this isolated development branch."""
import base64, hashlib, json, lzma
from pathlib import Path
parts=''.join(Path(f'scripts/visual-delta.{i}').read_text() for i in range(4))
payload=lzma.decompress(base64.b64decode(parts))
assert hashlib.sha256(payload).hexdigest()=='c8b823b847c7888391ee105f243f699d92dc06106dcbd1bc86b1608098b49ded'
for name, edit in json.loads(payload).items():
    path=Path(name)
    assert not path.is_absolute() and '..' not in path.parts
    assert name.startswith(('src/','docs/','tests/')) or name=='playwright.config.mjs'
    if 'new' in edit:
        assert not path.exists(),name
        result=edit['new'].encode('utf-8')
    else:
        before=path.read_bytes()
        assert hashlib.sha256(before).hexdigest()==edit['base'],('base mismatch',name,hashlib.sha256(before).hexdigest())
        if edit.get('delete'):
            path.unlink();continue
        lines=before.decode('utf-8').splitlines(keepends=True)
        for start,end,replacement in reversed(edit['ops']):
            assert 0<=start<=end<=len(lines)
            lines[start:end]=replacement
        result=''.join(lines).encode('utf-8')
        assert hashlib.sha256(result).hexdigest()==edit['result'],('result mismatch',name)
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(result)
    print(name,hashlib.sha256(result).hexdigest())
