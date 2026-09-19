import type { Tool, ToolContext, ToolEvent } from "./tool";

/** The Text tool (spec M10 §6): a click places a title, and that is the whole gesture. Unlike the
 *  pen it holds no draft — a title is created in one step — so invariant 33 does not apply. */
export function createTextTool(): Tool {
  let start: ToolEvent | null = null;

  return {
    id: "text",
    hint: "Click to place a title · type it in the properties panel",
    cursor: "text",

    down(_ctx: ToolContext, e: ToolEvent) {
      start = e;
    },

    move() {},

    up(ctx: ToolContext, e: ToolEvent) {
      const s = start;
      start = null;
      if (!s) return;
      // A click, not a drag: the same movedEnough rule the select tool uses, in screen pixels.
      const dx = e.screen.x - s.screen.x;
      const dy = e.screen.y - s.screen.y;
      if (dx * dx + dy * dy > 16) return;
      ctx.placeTitle(e.doc);
    },

    cancel() {
      start = null;
    },
  };
}
