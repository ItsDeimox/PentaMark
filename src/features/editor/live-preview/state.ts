import { StateEffect } from "@codemirror/state";

export type LiveSourceReveal = {
  from: number;
  to: number;
  paddingBefore: number;
  scrollRoom: number;
};

export const liveSourceRevealEffect = StateEffect.define<LiveSourceReveal>();
