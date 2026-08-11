import { defaultKeymap, history as codeMirrorHistory, historyKeymap } from "@codemirror/commands";
import { markdown as codeMirrorMarkdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Annotation, Compartment, EditorSelection, EditorState, StateEffect, StateField } from "@codemirror/state";
import { EditorView, drawSelection, keymap, type DecorationSet } from "@codemirror/view";
import React, { useEffect, useRef, useState } from "react";
import { formatSelectionValue } from "./formatting";
import { buildLivePreviewDecorations } from "./live-preview/decorations";
import { liveSourceRevealEffect, type LiveSourceReveal } from "./live-preview/state";
import type { LiveEditorApi, LiveEditorProps } from "./live-preview/types";

export type { LiveEditorApi } from "./live-preview/types";

const liveExternalUpdate = Annotation.define<boolean>();
const liveRefreshEffect = StateEffect.define<number>();

export function LivePreviewEditor(props: LiveEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const propsRef = useRef(props);
  const readOnlyCompartment = useRef(new Compartment());
  const renderVersion = useRef(0);
  const focusedRef = useRef(false);
  const [mountError, setMountError] = useState("");
  propsRef.current = props;

  useEffect(() => {
    if (!hostRef.current) return;
    let view: EditorView | null = null;

    try {
      // This direct StateField is intentional: only directly-provided
      // decorations may change CodeMirror's vertical layout.
      type PreviewFieldValue = { decorations: DecorationSet; reveal: LiveSourceReveal | null };
      const previewField = StateField.define<PreviewFieldValue>({
        create(state) {
          return {
            decorations: buildLivePreviewDecorations(state, propsRef, renderVersion.current, focusedRef),
            reveal: null,
          };
        },
        update(value, transaction) {
          let reveal = value.reveal;
          for (const effect of transaction.effects) {
            if (effect.is(liveSourceRevealEffect)) reveal = effect.value;
          }
          if (transaction.docChanged) reveal = null;
          if (reveal && !transaction.state.selection.ranges.some((range) => (
            range.empty
              ? range.from >= reveal!.from && range.from <= reveal!.to
              : range.from <= reveal!.to && range.to >= reveal!.from
          ))) reveal = null;

          if (transaction.docChanged
            || transaction.selection
            || transaction.effects.some((effect) => (
              effect.is(liveRefreshEffect) || effect.is(liveSourceRevealEffect)
            ))) {
            return {
              decorations: buildLivePreviewDecorations(
                transaction.state,
                propsRef,
                renderVersion.current,
                focusedRef,
                reveal,
              ),
              reveal,
            };
          }
          return value;
        },
        provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
      });

      const state = EditorState.create({
        doc: props.value,
        extensions: [
          codeMirrorMarkdown({ base: markdownLanguage }),
          codeMirrorHistory(),
          EditorState.allowMultipleSelections.of(true),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": "Editor Markdown em Live Preview",
            spellcheck: "true",
          }),
          drawSelection(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          readOnlyCompartment.current.of(EditorState.readOnly.of(props.readOnly)),
          previewField,
          EditorView.domEventHandlers({
            focus(_event, currentView) {
              focusedRef.current = true;
              currentView.dispatch({ effects: liveRefreshEffect.of(++renderVersion.current) });
              return false;
            },
            blur(_event, currentView) {
              focusedRef.current = false;
              currentView.dispatch({ effects: liveRefreshEffect.of(++renderVersion.current) });
              propsRef.current.onLinkLeave();
              return false;
            },
            click(event) {
              const target = event.target as HTMLElement;
              const notePath = target.closest<HTMLElement>("[data-pm-note]")?.dataset.pmNote;
              const assetTarget = target.closest<HTMLElement>("[data-pm-asset]")?.dataset.pmAsset;
              if (!(event.ctrlKey || event.metaKey) || (!notePath && !assetTarget)) return false;
              event.preventDefault();
              event.stopPropagation();
              if (notePath) propsRef.current.onOpenNote(notePath);
              else if (assetTarget) propsRef.current.onOpenAsset(assetTarget);
              return true;
            },
            mousemove(event) {
              if ((event.target as HTMLElement).closest("[data-pm-note]")) propsRef.current.onLinkHover(event);
              else propsRef.current.onLinkLeave();
              return false;
            },
            mouseleave() {
              propsRef.current.onLinkLeave();
              return false;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged
              && !update.transactions.some((transaction) => transaction.annotation(liveExternalUpdate))) {
              propsRef.current.onChange(update.state.doc.toString());
            }
            if (update.selectionSet || update.docChanged) {
              const main = update.state.selection.main;
              propsRef.current.onSelection(main.from, main.to);
            }
          }),
        ],
      });

      view = new EditorView({ state, parent: hostRef.current });
      viewRef.current = view;
      props.apiRef.current = {
        applyFormat(kind) {
          const transaction = view!.state.changeByRange((range) => {
            const source = view!.state.doc.toString();
            const formatted = formatSelectionValue(source, range.from, range.to, kind);
            return {
              changes: {
                from: formatted.changeStart,
                to: formatted.changeEnd,
                insert: formatted.replacement,
              },
              range: EditorSelection.range(formatted.selectionStart, formatted.selectionEnd),
            };
          });
          view!.dispatch(transaction);
          view!.focus();
        },
        focus: () => view!.focus(),
        selection: () => ({
          from: view!.state.selection.main.from,
          to: view!.state.selection.main.to,
        }),
      };
    } catch (error) {
      console.error("Falha ao iniciar o Live Preview", error);
      setMountError(error instanceof Error ? error.message : "Falha desconhecida no editor");
      props.apiRef.current = null;
      viewRef.current = null;
      view?.destroy();
      return;
    }

    return () => {
      props.apiRef.current = null;
      viewRef.current = null;
      view?.destroy();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === props.value) return;
    const selection = view.state.selection.main;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: props.value },
      selection: EditorSelection.range(
        Math.min(selection.from, props.value.length),
        Math.min(selection.to, props.value.length),
      ),
      annotations: liveExternalUpdate.of(true),
    });
  }, [props.value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    renderVersion.current += 1;
    view.dispatch({ effects: liveRefreshEffect.of(renderVersion.current) });
  }, [props.context, props.remoteClients]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(props.readOnly)),
    });
  }, [props.readOnly]);

  if (mountError) {
    return <div className="pm-live-recovery">
      <strong>O Live Preview encontrou um erro, mas suas notas estão seguras.</strong>
      <span>{mountError}</span>
      <textarea
        value={props.value}
        readOnly={props.readOnly}
        spellCheck
        onChange={(event) => props.onChange(event.target.value)}
        aria-label="Editor Markdown de recuperação"
      />
    </div>;
  }

  return <div ref={hostRef} className="pm-live-codemirror" />;
}
