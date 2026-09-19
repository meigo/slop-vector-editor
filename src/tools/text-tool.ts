import { movedEnough, type Tool, type ToolContext, type ToolEvent } from "./tool";

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
      // A click, not a drag — the project's one threshold, shared with select and the shape tools.
      // An inlined 4px rule here disagreed with their 2px and made a 3px wobble mean two things.
      if (movedEnough(s.screen, e.screen)) return;
      ctx.placeTitle(e.doc);
    },

    cancel() {
      start = null;
    },
  };
}
