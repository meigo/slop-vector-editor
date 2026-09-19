import type { Doc } from "../doc/document";
import type { NodeRef } from "../doc/path-edit";
import type { Box } from "../geom/box";
import type { Vec } from "../geom/vec";
import type { Prefs } from "../persist/preferences";
import type { View } from "../state/viewport";
import type { Mods, ToolId } from "./types";

export type ToolEvent = { doc: Vec; screen: Vec; pointerType: string; mods: Mods; time: number };

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
  /** Selects the character of the selected title under a document point (spec M10 §6). */
  pickCharacter(at: Vec): void;
  /** Moves the selected character by a document-space delta. */
  nudgeCharacter(dx: number, dy: number): void;
  /** The selected title's id, or null — the tool needs it to tell "click inside a title I am
   *  already editing" from "click on empty canvas, place a new one". */
  titleId(): string | null;
  charSel(): number | null;
  notify(kind: "info" | "error", text: string): void;
  setOverlay(o: Overlay): void;
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
}

export const MIN_DRAG_PX = 2;

export function pointerTolerance(pointerType: string): number {
  return pointerType === "mouse" ? 6 : 14;
}

export function movedEnough(a: Vec, b: Vec): boolean {
  return Math.hypot(b.x - a.x, b.y - a.y) >= MIN_DRAG_PX;
}
