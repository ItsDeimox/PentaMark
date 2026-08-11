export function escapeCode(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function escapeAttribute(value: string) {
  return escapeCode(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function encodeSource(value: string) {
  return encodeURIComponent(value);
}

export function decodeSource(value: string | undefined) {
  try { return decodeURIComponent(value || ""); }
  catch { return ""; }
}

export function replaceNth(source: string, needle: string, replacement: string, ordinal: number) {
  let from = 0;
  let found = -1;
  for (let index = 0; index <= ordinal; index += 1) {
    found = source.indexOf(needle, from);
    if (found < 0) return source;
    from = found + needle.length;
  }
  return `${source.slice(0, found)}${replacement}${source.slice(found + needle.length)}`;
}

