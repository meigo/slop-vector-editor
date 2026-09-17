import type { Doc } from "../doc/document";
import type { Box } from "../geom/box";
import type { Vec } from "../geom/vec";
import type { Prefs } from "../persist/preferences";
import type { View } from "../state/viewport";
import type { Mods, ToolId } from "./types";

export type ToolEvent = { doc: Vec; screen: Vec; pointerType: string; mods: Mods };

/** Transient drawing that is not part of the document (doc-space coordinates). */
export type Overlay =
  { kind: "marquee"; box: Box } | { kind: "guides"; xs: number[]; ys: number[] } | null;

/** Everything a tool may read or change. The app binds it to the store; tests use a fake. */
export interface ToolContext {
  doc(): Doc;
  view(): View;
  selection(): readonly string[];
  currentLayerId(): string;
  setSelection(ids: readonly string[]): void;
  commit(doc: Doc): void;
  beginGesture(): void;
  endGesture(): void;
  prefs(): Prefs;
  /** Whether moves, resizes and drawing should snap (the Snap toggle). */
  snapEnabled(): boolean;
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
}

export const MIN_DRAG_PX = 2;

export function pointerTolerance(pointerType: string): number {
  return pointerType === "mouse" ? 6 : 14;
}

export function movedEnough(a: Vec, b: Vec): boolean {
  return Math.hypot(b.x - a.x, b.y - a.y) >= MIN_DRAG_PX;
}
