import type { ToolId } from "../tools/types";

export type RouteInput = {
  pointerType: string;
  button: number;
  /** Pointers already down on the canvas before this one. */
  activePointers: number;
  /** Touch pointers already down. */
  activeTouches: number;
  spaceHeld: boolean;
  tool: ToolId;
  /** A Pencil has touched the canvas this session: fingers then only navigate. */
  pencilSeen: boolean;
  /** A pen or mouse gesture is already running: fingers must not interrupt it. */
  penActive: boolean;
};

export type Route = "tool" | "pan" | "pinch" | "menu" | "ignore";

export function routePointerDown(i: RouteInput): Route {
  // A finger never interrupts a Pencil or mouse gesture — that is a palm, not an intent (spec M5 §2).
  if (i.pointerType === "touch" && i.penActive) return "ignore";
  // A Pencil takes over from fingers already on the glass, so a resting hand can't stop a stroke
  // before it starts. Only fingers are overridden: a second pen, or a mouse, is not.
  const takesOver =
    i.pointerType === "pen" && i.activePointers > 0 && i.activePointers === i.activeTouches;
  if (!takesOver) {
    if (i.pointerType === "touch" && i.activeTouches >= 1) return "pinch";
    if (i.activePointers >= 1) return "ignore";
  }
  if (i.pointerType === "mouse") {
    if (i.button === 2) return "menu";
    if (i.button === 1) return "pan";
    if (i.button !== 0) return "ignore";
  }
  if (i.spaceHeld || i.tool === "hand") return "pan";
  if (i.pointerType === "touch" && i.pencilSeen) return "pan";
  return "tool";
}
