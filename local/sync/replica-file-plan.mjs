import { publicPath, safePath, exists } from './paths.mjs';

const key = path => publicPath(path).pathKey;
const vacates = f => f.before && !f.before.deleted && (f.desired.deleted || key(f.before.path) !== key(f.desired.path));

/** Plan filesystem dependencies before persisting an intent. Cyclic moves need
 * an explicit intermediate name and are rejected before touching disk. */
export async function orderReplicaFiles(root, files) {
  const dependencies = new Map(files.map(f => [f, new Set()]));
  for (const file of files) {
    const target = key(file.desired.path);
    if (!file.desired.deleted) {
      const prior = files.filter(other => other !== file && vacates(other) && key(other.before.path) === target);
      for (const other of prior) dependencies.get(file).add(other);
      if ((!file.before || file.before.deleted || key(file.before.path) !== target) && !prior.length && await exists(await safePath(root, file.desired.path))) throw new Error('path-collision');
      for (const other of files) if (other !== file && !other.desired.deleted && other.desired.kind === 'directory' && target.startsWith(key(other.desired.path) + '/')) dependencies.get(file).add(other);
    }
    if (file.desired.kind === 'directory' && file.desired.deleted) {
      for (const other of files) if (other !== file && vacates(other) && key(other.before.path).startsWith(target + '/')) dependencies.get(file).add(other);
    }
  }
  const ordered = [];
  while (dependencies.size) {
    const ready = [...dependencies].find(([, deps]) => deps.size === 0)?.[0];
    if (!ready) throw new Error('cyclic-file-plan');
    ordered.push(ready); dependencies.delete(ready);
    for (const deps of dependencies.values()) deps.delete(ready);
  }
  return ordered;
}

export function finalFileEffects(files) {
  // A deletion followed by publication at that pathname is represented by the
  // final publication, not by a requirement that the path still be absent.
  const final = new Map();
  for (const file of files) if (!file.skipped) final.set(key(file.desired.path), file);
  return [...final.values()];
}
