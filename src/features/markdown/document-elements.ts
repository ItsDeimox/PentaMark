/**
 * DOM primitives shared by semantic Markdown and CodeMirror widgets.
 * These are deliberately framework-agnostic because the renderer emits HTML
 * strings while CodeMirror expects real DOM nodes.
 */
export const DOCUMENT_LIST_MARKER_CLASS = "pm-list-marker";
export const DOCUMENT_LIST_ITEM_CLASS = "pm-list-item--custom-marker";

export function createDocumentListMarker(label = "", ordered = false) {
  const marker = document.createElement("span");
  marker.className = `${DOCUMENT_LIST_MARKER_CLASS}${ordered ? ` ${DOCUMENT_LIST_MARKER_CLASS}--ordered` : ""}`;
  marker.textContent = ordered ? label : "";
  if (!ordered) marker.setAttribute("aria-hidden", "true");
  return marker;
}

export function decorateDocumentListMarkers(root: ParentNode) {
  for (const item of root.querySelectorAll<HTMLLIElement>(
    "ul:not(.contains-task-list) > li:not(.task-list-item)",
  )) {
    if (item.querySelector(`:scope > .${DOCUMENT_LIST_MARKER_CLASS}`)) continue;
    item.classList.add(DOCUMENT_LIST_ITEM_CLASS);
    item.prepend(createDocumentListMarker());
  }
}
