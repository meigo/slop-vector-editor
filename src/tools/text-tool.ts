import { movedEnough, type Tool, type ToolContext, type ToolEvent } from "./tool";

/** The Text tool (spec M10 §6): a click places a title, and that is the whole gesture. Unlike the
 *  pen it holds no draft — a title is created in one step — so invariant 33 does not apply. */
export function createTextTool(): Tool {
  let start: ToolEvent | null = null;
  /** Set on pointer-down when the press was on the character already selected: the drag then moves
   *  that character instead of doing nothing. */
  let dragging = false;
  /** The offset the character had when the drag began: every move sets base + total travel, so a
   *  call dropped by the store's re-entrancy guard costs nothing. */
  let base: { dx: number; dy: number } | null = null;

  return {
    id: "text",
    hint: "Click to place a title · type it in the properties panel",
    cursor: "text",

    down(ctx: ToolContext, e: ToolEvent) {
      start = e;
      // A press inside a title that is already being edited begins a character drag; the pick
      // itself happens on up, so a click that turns into a drag still drags (invariant 32).
      dragging = ctx.titleId() !== null && ctx.charSel() !== null;
      if (dragging) {
        base = ctx.charOffset();
        ctx.beginGesture();
      }
    },

    move(ctx: ToolContext, e: ToolEvent) {
      if (!dragging || !start || !base) return;
      if (!movedEnough(start.screen, e.screen)) return;
      ctx.setCharOffset(base.dx + (e.doc.x - start.doc.x), base.dy + (e.doc.y - start.doc.y));
    },

    up(ctx: ToolContext, e: ToolEvent) {
      const s = start;
      const b = base;
      const wasDragging = dragging;
      start = null;
      base = null;
      dragging = false;
      if (wasDragging) {
        // Land the character exactly where the pointer was released. `move` is not guaranteed to
        // fire at the final position — the browser coalesces moves, and the last one can be well
        // behind the release point — so without this the letter stops short of where it was
        // dropped, by however much the last move lagged.
        if (s && b && movedEnough(s.screen, e.screen)) {
          ctx.setCharOffset(b.dx + (e.doc.x - s.doc.x), b.dy + (e.doc.y - s.doc.y));
        }
        ctx.finishCharDrag();
      }
      if (!s) return;
      // A click, not a drag — the project's one threshold, shared with select and the shape tools.
      // An inlined 4px rule here disagreed with their 2px and made a 3px wobble mean two things.
      if (movedEnough(s.screen, e.screen)) return;
      // Inside a title already being edited, a click picks a character rather than placing another
      // title on top of it (spec M10 §6).
      if (ctx.titleId() !== null) ctx.pickCharacter(e.doc);
      else ctx.placeTitle(e.doc);
    },

    cancel(ctx: ToolContext) {
      if (dragging) ctx.finishCharDrag();
      start = null;
      base = null;
      dragging = false;
    },
  };
}
