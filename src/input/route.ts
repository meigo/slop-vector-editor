import type { ToolId } from "../tools/types";

export type RouteInput = {
  pointerType: string;
  button: number;
  /** Pointers already down on the canvas before this one. */
  activePointers: number;
  spaceHeld: boolean;
  tool: ToolId;
  /** A Pencil has touched the canvas this session: fingers then only navigate. */
  pencilSeen: boolean;
};

export type Route = "tool" | "pan" | "pinch" | "menu" | "ignore";

export function routePointerDown(i: RouteInput): Route {
  if (i.pointerType === "touch" && i.activePointers >= 1) return "pinch";
  if (i.pointerType === "mouse") {
    if (i.button === 2) return "menu";
    if (i.button === 1) return "pan";
    if (i.button !== 0) return "ignore";
  }
  if (i.activePointers >= 1) return "ignore";
  if (i.spaceHeld || i.tool === "hand") return "pan";
  if (i.pointerType === "touch" && i.pencilSeen) return "pan";
  return "tool";
}
