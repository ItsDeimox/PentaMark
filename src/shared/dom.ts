export function textareaCaretPosition(textarea: HTMLTextAreaElement, position: number) {
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  const properties = [
    "boxSizing", "width", "height", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "fontFamily", "fontSize",
    "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "textTransform", "textIndent", "tabSize",
  ] as const;
  mirror.style.position = "fixed";
  mirror.style.left = "-9999px";
  mirror.style.top = "0";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.overflow = "hidden";
  for (const property of properties) (mirror.style as unknown as Record<string, string>)[property] = computed[property];
  mirror.textContent = textarea.value.slice(0, Math.max(0, Math.min(position, textarea.value.length)));
  const marker = document.createElement("span");
  marker.textContent = textarea.value.slice(position, position + 1) || "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const result = { left: marker.offsetLeft - textarea.scrollLeft, top: marker.offsetTop - textarea.scrollTop, height: Number.parseFloat(computed.lineHeight) || 22 };
  mirror.remove();
  return result;
}
