export type DocumentBlockType =
  | "heading"
  | "list"
  | "quote"
  | "code"
  | "paragraph"
  | "properties"
  | "table"
  | "media"
  | "separator";

type BlockSpacing = Readonly<{ top: number; bottom: number }>;

const headingSpacing = [
  { top: 0, bottom: 27 },
  { top: 38, bottom: 14 },
  { top: 29, bottom: 11 },
  { top: 24, bottom: 9 },
  { top: 20, bottom: 8 },
  { top: 20, bottom: 8 },
] as const satisfies readonly BlockSpacing[];

/**
 * Numeric document contract shared by semantic Markdown and CodeMirror.
 * CSS consumes these values through variables applied by DocumentWorkspace;
 * Live Preview consumes the same object for measured layout decorations.
 */
export const DOCUMENT_LAYOUT = Object.freeze({
  reader: Object.freeze({ width: 790, paddingTop: 44, paddingBottom: 130, sidePadding: 32 }),
  paragraph: Object.freeze({ top: 0, bottom: 18 }),
  heading: Object.freeze({ spacing: headingSpacing, ruledPaddingBottom: 20 }),
  list: Object.freeze({ top: 10, bottom: 22, indent: 24, itemIndent: 4, itemGap: 5 }),
  task: Object.freeze({ listIndent: 20, contentIndent: 34, checkboxLeft: 4 }),
  quote: Object.freeze({ top: 22, bottom: 22, paddingBlock: 15, paddingInline: 18 }),
  code: Object.freeze({ top: 23, bottom: 23 }),
  table: Object.freeze({ top: 22, bottom: 22 }),
  media: Object.freeze({ top: 24, bottom: 24 }),
  separator: Object.freeze({ top: 34, bottom: 34 }),
  properties: Object.freeze({ top: 0, bottom: 28 }),
});

export function documentBlockSpacing(type: DocumentBlockType, headingLevel = 1): BlockSpacing {
  if (type === "heading") {
    const level = Math.max(1, Math.min(6, headingLevel));
    return DOCUMENT_LAYOUT.heading.spacing[level - 1];
  }
  return DOCUMENT_LAYOUT[type];
}

const px = (value: number) => `${value}px`;

export const DOCUMENT_STYLE_VARIABLES = Object.freeze({
  "--pm-reader-width": px(DOCUMENT_LAYOUT.reader.width),
  "--pm-reader-half-width": px(DOCUMENT_LAYOUT.reader.width / 2),
  "--pm-reader-padding-top": px(DOCUMENT_LAYOUT.reader.paddingTop),
  "--pm-reader-padding-bottom": px(DOCUMENT_LAYOUT.reader.paddingBottom),
  "--pm-reader-side-padding": px(DOCUMENT_LAYOUT.reader.sidePadding),
  "--pm-md-paragraph-bottom": px(DOCUMENT_LAYOUT.paragraph.bottom),
  "--pm-md-h1-margin-top": px(DOCUMENT_LAYOUT.heading.spacing[0].top),
  "--pm-md-h1-margin-bottom": px(DOCUMENT_LAYOUT.heading.spacing[0].bottom),
  "--pm-md-h2-margin-top": px(DOCUMENT_LAYOUT.heading.spacing[1].top),
  "--pm-md-h2-margin-bottom": px(DOCUMENT_LAYOUT.heading.spacing[1].bottom),
  "--pm-md-h3-margin-top": px(DOCUMENT_LAYOUT.heading.spacing[2].top),
  "--pm-md-h3-margin-bottom": px(DOCUMENT_LAYOUT.heading.spacing[2].bottom),
  "--pm-md-h4-margin-top": px(DOCUMENT_LAYOUT.heading.spacing[3].top),
  "--pm-md-h4-margin-bottom": px(DOCUMENT_LAYOUT.heading.spacing[3].bottom),
  "--pm-md-h5-margin-top": px(DOCUMENT_LAYOUT.heading.spacing[4].top),
  "--pm-md-h5-margin-bottom": px(DOCUMENT_LAYOUT.heading.spacing[4].bottom),
  "--pm-md-ruled-padding-bottom": px(DOCUMENT_LAYOUT.heading.ruledPaddingBottom),
  "--pm-md-list-margin-top": px(DOCUMENT_LAYOUT.list.top),
  "--pm-md-list-margin-bottom": px(DOCUMENT_LAYOUT.list.bottom),
  "--pm-md-list-indent": px(DOCUMENT_LAYOUT.list.indent),
  "--pm-md-list-item-indent": px(DOCUMENT_LAYOUT.list.itemIndent),
  "--pm-md-list-item-gap": px(DOCUMENT_LAYOUT.list.itemGap),
  "--pm-md-task-list-indent": px(DOCUMENT_LAYOUT.task.listIndent),
  "--pm-md-task-content-indent": px(DOCUMENT_LAYOUT.task.contentIndent),
  "--pm-md-task-checkbox-left": px(DOCUMENT_LAYOUT.task.checkboxLeft),
  "--pm-md-quote-margin": px(DOCUMENT_LAYOUT.quote.top),
  "--pm-md-quote-padding-block": px(DOCUMENT_LAYOUT.quote.paddingBlock),
  "--pm-md-quote-padding-inline": px(DOCUMENT_LAYOUT.quote.paddingInline),
  "--pm-md-code-margin": px(DOCUMENT_LAYOUT.code.top),
  "--pm-md-table-margin": px(DOCUMENT_LAYOUT.table.top),
  "--pm-md-media-margin": px(DOCUMENT_LAYOUT.media.top),
  "--pm-md-separator-margin": px(DOCUMENT_LAYOUT.separator.top),
  "--pm-md-properties-margin-top": px(DOCUMENT_LAYOUT.properties.top),
  "--pm-md-properties-margin-bottom": px(DOCUMENT_LAYOUT.properties.bottom),
} as const);
