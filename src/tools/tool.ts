import type { Doc, Paint } from "../doc/document";
import type { GradientKind, PaintSlot, StopEnd } from "../doc/paint-edit";
import type { NodeRef } from "../doc/path-edit";
import type { Box } from "../geom/box";
import type { Vec } from "../geom/vec";
import type { Cage } from "../geom/warp";
import type { TextEdit } from "../text/edit";
import type { Prefs } from "../persist/preferences";
import type { View } from "../state/viewport";
import type { Mods, ToolId } from "./types";

export type ToolEvent = {
  doc: Vec;
  screen: Vec;
  pointerType: string;
  mods: Mods;
  time: number;
  /** Pen pressure, 0–1; read only for `pointerType === "pen"` (spec M21 §2). */
  pressure: number;
  /** The coalesced samples of a move (spec M21 §2) — only the brush reads them. */
  samples?: { doc: Vec; screen: Vec; pressure: number; time: number }[];
};

/** Transient drawing that is not part of the document (doc-space coordinates). */
export type Overlay =
  | { kind: "marquee"; box: Box }
  | { kind: "guides"; xs: number[]; ys: number[] }
  | {
      kind: "pen";
      /** Document-space polylines of the draft's outline. */
      outline: Vec[][];
      knobs: Vec[];
      handles: { a: Vec; b: Vec }[];
      rubber: { a: Vec; b: Vec } | null;
      /** Whether a press at the pointer would close the path — the first knob fills (spec §7). */
      closeHint: boolean;
    }
  | { kind: "cage"; cage: Cage }
  | {
      kind: "brush";
      /** The stroke's real paint (spec M21 §5); `opacity` is the style opacity, and the preview
       *  multiplies it with `fill.opacity`. */
      fill: Paint;
      opacity: number;
      /** The stroke being drawn, as a closed document-space outline. */
      live: Vec[] | null;
      /** The size cursor: a circle of radius `r` (document px) at the hovering pointer. */
      cursor: { at: Vec; r: number } | null;
    }
  | null;

/** Everything a tool may read or change. The app binds it to the store; tests use a fake. */
export interface ToolContext {
  doc(): Doc;
  view(): View;
  selection(): readonly string[];
  currentLayerId(): string;
  /** The group the user is working inside (spec M3b §3), or null at the top. */
  enteredGroupId(): string | null;
  setEnteredGroup(id: string | null): void;
  /** The path being node-edited (spec M4a §2), or null. */
  nodeTarget(): string | null;
  setNodeTarget(id: string | null): void;
  nodeSel(): readonly NodeRef[];
  setNodeSel(refs: readonly NodeRef[]): void;
  setTool(id: ToolId): void;
  setSelection(ids: readonly string[]): void;
  commit(doc: Doc): void;
  beginGesture(): void;
  endGesture(): void;
  prefs(): Prefs;
  /** Whether moves, resizes and drawing should snap (the Snap toggle). */
  snapEnabled(): boolean;
  /** Places a title at a document point (spec M10 §6). The store owns this because outlining
   *  needs the font, which is an async lazy-chunk load — a tool's `up` is synchronous, and
   *  invariant 12 keeps tools out of the store. */
  placeTitle(at: Vec): void;
  /** Commits a finished brush stroke's outline (spec M21 §4.2). The store owns it for the same
   *  reason as `placeTitle`: simplifying awaits Paper's lazy chunk. */
  commitBrushStroke(outline: readonly Vec[]): void;
  /** Selects the character of the selected title under a document point (spec M10 §6). */
  pickCharacter(at: Vec): void;
  /** The index of the selected title's character under a document point, or null — the same test
   *  as `pickCharacter`, with no side effects (spec M22 §3: a press on the selected character). */
  charAtPoint(at: Vec): number | null;
  /** The selected character's current offset, read once when a drag begins. */
  charOffset(): { dx: number; dy: number };
  /** Sets that offset absolutely — see the note on `setCharOffset` in the store. */
  setCharOffset(dx: number, dy: number): void;
  /** Closes the character-drag bracket after its outline commit, which is async. */
  finishCharDrag(): void;
  /** The selected title's id, or null — the tool needs it to tell "click inside a title I am
   *  already editing" from "click on empty canvas, place a new one". */
  titleId(): string | null;
  charSel(): number | null;
  notify(kind: "info" | "error", text: string): void;
  setOverlay(o: Overlay): void;
  /** Which paint the Gradient tool edits (spec M15 §6). */
  gradientTarget(): PaintSlot;
  /** The kind a drawn gradient is drawn as (spec M16 §5). */
  gradientType(): GradientKind;
  /** The stop picked on the canvas, or null (spec M15 §7). `which` is the paint slot it was
   *  picked on — recorded so switching `gradientTarget` afterwards can't relabel it (review
   *  finding 7). */
  gradientStop(): { id: string; stop: StopEnd; which: PaintSlot } | null;
  setGradientStop(pick: { id: string; stop: StopEnd; which: PaintSlot } | null): void;
  /** Drops any remembered gradient for these shapes' `which` slot (fix M16 review finding 1): the
   *  Gradient tool calls this once per gesture, right after a DRAW or a KNOB/LINE drag actually
   *  commits — never on a cancelled one, which restores the document instead — so a stashed
   *  gradient older than what was just drawn can't be resurrected by a later Type switch. */
  forgetGradients(ids: readonly string[], which: PaintSlot): void;
  /** A cursor for what is under a hovering pointer (spec M17 §6), shown in place of the tool's
   *  static `cursor`; null restores it. Desktop only in practice — touch has no hover. */
  setHoverCursor(c: string | null): void;
  /** The title being edited on the canvas and its selection (spec M22 §2), or null. */
  textEdit(): TextEdit | null;
  /** Enters editing a title: the caret at a document point, or "all" of its text selected. Focuses
   *  the hidden textarea synchronously, so call it from the pointer handler itself (spec M22 §1). */
  beginTextEdit(id: string, at: Vec | "all"): void;
  /** Sets the edited title's selection, in code points. */
  setTextSelection(anchor: number, focus: number): void;
  /** The index nearest a document point in the edited title, or null (not editing, no stops yet,
   *  or a singular matrix). */
  textIndexAt(at: Vec): number | null;
  /** Leaves editing, committing the text with reporting. */
  endTextEdit(): void;
  /** The word around an index of the edited title's text (a double tap). */
  textWordAt(index: number): { start: number; end: number };
}

export interface Tool {
  readonly id: ToolId;
  readonly hint: string;
  readonly cursor: string;
  down(ctx: ToolContext, e: ToolEvent): void;
  /** Only called between `down` and `up`/`cancel`. */
  move(ctx: ToolContext, e: ToolEvent): void;
  up(ctx: ToolContext, e: ToolEvent): void;
  cancel(ctx: ToolContext): void;
  /** True when the tool consumed the key; the store then does nothing else. */
  keydown?(ctx: ToolContext, key: "escape" | "enter" | "backspace"): boolean;
  /** Whether a gesture or draft is in progress — the store asks before routing those keys. */
  busy?(): boolean;
  /** Drop an in-progress draft without committing it, and clear the overlay. The store calls this
   *  when the whole document changes under the draft: replace, undo, redo. */
  discard?(ctx: ToolContext): void;
  /** Pointer movement the canvas reports while no gesture is running — usually a plain hover, but
   *  also a held right-button drag or a pointer the router ignored. */
  hover?(ctx: ToolContext, e: ToolEvent): void;
  /** Called when the tool becomes active (spec M14 §5, plan ruling 1). */
  activate?(ctx: ToolContext): void;
  /** Something outside the tool is about to edit the document or change the selection: commit
   *  whatever session it holds (spec M14 §5, plan ruling 1/2). */
  settle?(ctx: ToolContext): void;
}

export const MIN_DRAG_PX = 2;

export function pointerTolerance(pointerType: string): number {
  return pointerType === "mouse" ? 6 : 14;
}

export function movedEnough(a: Vec, b: Vec): boolean {
  return Math.hypot(b.x - a.x, b.y - a.y) >= MIN_DRAG_PX;
}
