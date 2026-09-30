import type { ToolId } from "../tools/types";

/** "Fingers select" (2026-09-30), the modifier dock's toggle. Once a Pencil has touched the canvas,
 *  one finger only navigates (`route.ts`, Procreate's convention) — so a resting finger or knuckle
 *  never draws or picks by accident. With the toggle on, a quick, still finger tap is delivered to
 *  the tool as a click, but only for the tools where a tap means "pick" (select, enter a group, pick
 *  a node, a title, a gradient stop); a finger that moves still pans, and a drawing tool never gets
 *  a finger. Off by default: the safer mode for drawing with the Pencil. */

const PICKING: ReadonlySet<ToolId> = new Set<ToolId>(["select", "node", "gradient", "text"]);

export function fingerPicks(tool: ToolId): boolean {
  return PICKING.has(tool);
}

/** A tap: down and up within this long … */
export const FINGER_TAP_MS = 500;
/** … and this far apart on either axis (screen px) — the same reach as a long press. */
export const FINGER_TAP_SLOP = 10;

type Stamp = { x: number; y: number; t: number };

export function isFingerTap(down: Stamp, up: Stamp): boolean {
  return (
    up.t - down.t < FINGER_TAP_MS &&
    Math.abs(up.x - down.x) <= FINGER_TAP_SLOP &&
    Math.abs(up.y - down.y) <= FINGER_TAP_SLOP
  );
}
