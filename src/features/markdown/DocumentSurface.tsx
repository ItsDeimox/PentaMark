import React, { forwardRef, useEffect, useRef, type CSSProperties, type HTMLAttributes } from "react";
import { DOCUMENT_STYLE_VARIABLES } from "./document-layout";
import { renderDynamicMarkdown, type MarkdownContext } from "./renderer";

type DocumentMode = "edit" | "preview" | "split" | "live";
type VariableStyle = CSSProperties & Record<`--${string}`, string | number>;

function classes(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

type DocumentWorkspaceProps = HTMLAttributes<HTMLDivElement> & { mode: DocumentMode };

export function DocumentWorkspace({ mode, className, style, ...props }: DocumentWorkspaceProps) {
  return <div
    {...props}
    className={classes("pm-document", `pm-document--${mode}`, className)}
    style={{ ...DOCUMENT_STYLE_VARIABLES, ...style } as VariableStyle}
  />;
}

type DocumentSurfaceProps = HTMLAttributes<HTMLDivElement> & { mode: "preview" | "live" };

export const DocumentSurface = forwardRef<HTMLDivElement, DocumentSurfaceProps>(function DocumentSurface(
  { mode, className, ...props },
  ref,
) {
  return <div
    {...props}
    ref={ref}
    className={classes("pm-document-surface", `pm-document-surface--${mode}`, mode === "preview" ? "pm-preview-pane" : "pm-live-pane", className)}
  />;
});

type MarkdownContentProps = Omit<HTMLAttributes<HTMLElement>, "children" | "dangerouslySetInnerHTML"> & {
  html: string;
  context: MarkdownContext;
};

export function MarkdownContent({ html, context, className, ...props }: MarkdownContentProps) {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const render = () => {
      if (rootRef.current) void renderDynamicMarkdown(rootRef.current, context);
    };
    const frame = requestAnimationFrame(render);
    const retry = window.setTimeout(render, 180);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(retry);
    };
  }, [context, html]);

  return <article
    {...props}
    ref={rootRef}
    className={classes("pm-markdown", className)}
    dangerouslySetInnerHTML={{ __html: html }}
  />;
}
