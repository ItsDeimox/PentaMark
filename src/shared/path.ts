export function joinPath(parent: string, name: string) {
  return parent ? `${parent}/${name}` : name;
}

export function parentOf(path: string) {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

export function baseName(path: string) {
  return path.split("/").pop() || path;
}

export function titleOf(path: string) {
  return baseName(path).replace(/\.md$/i, "");
}

export function ensureMarkdown(name: string) {
  const trimmed = name.trim();
  return trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;
}

