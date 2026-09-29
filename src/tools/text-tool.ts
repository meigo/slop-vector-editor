import { findNode } from "../doc/tree";
import { hitTest } from "../geom/hit";
import { isDoubleTap, type Tap } from "../input/double-tap";
import { movedEnough, pointerTolerance, type Tool, type ToolContext, type ToolEvent } from "./tool";

/** The title under a press, or null (spec M22 §3: hit-tested as the select tool does). */
function titleAt(ctx: ToolContext, e: ToolEvent): string | null {
  const doc = ctx.doc();
  const tol = pointerTolerance(e.pointerType) / ctx.view().zoom;
  const id = hitTest(doc, e.doc, tol, ctx.enteredGroupId())?.nodeId ?? null;
  if (id === null) return null;
  const n = findNode(doc, id)?.node;
  return n && n.kind === "path" && n.text ? id : null;
}

/** The Text tool (spec M10 §6, M22 §3). A click on a title edits it on the canvas — caret at the
 *  click, Shift extends, a double tap selects the word, a drag selects from the press — and a click
 *  on empty canvas places a new title, or, while editing, only leaves. A press on the single
 *  selected character drags that character. It holds no draft, so invariant 33 does not apply. */
export function createTextTool(): Tool {
  /** What the current press is doing, decided on pointer-down. */
  let press:
    | { kind: "place"; start: ToolEvent }
    | { kind: "char"; start: ToolEvent; base: { dx: number; dy: number } }
    | { kind: "text"; start: ToolEvent; index: number | null }
    | null = null;
  let lastTap: Tap | null = null;
  /** The context last seen — `busy()` takes none, and the session can be entered by the Select
   *  tool's double tap, so the tool cannot track it with a flag of its own. */
  let seen: ToolContext | null = null;

  /** Extends the text selection from the press to `e`, once the press has moved enough. */
  function dragSelect(
    ctx: ToolContext,
    p: { start: ToolEvent; index: number | null },
    e: ToolEvent,
  ) {
    if (!movedEnough(p.start.screen, e.screen)) return;
    const edit = ctx.textEdit();
    if (!edit) return;
    // A caret entered before the stops arrived is resolved by the store later: take it from there.
    const from = p.index ?? edit.anchor;
    ctx.setTextSelection(from, ctx.textIndexAt(e.doc) ?? edit.focus);
  }

  return {
    id: "text",
    hint: "Click a title to edit it · click empty canvas to place one · Esc finishes",
    cursor: "text",

    activate(ctx) {
      seen = ctx;
    },

    down(ctx: ToolContext, e: ToolEvent) {
      seen = ctx;
      const edit = ctx.textEdit();
      const sel = ctx.charSel();
      // A press on the one selected character drags it (spec M10 §6); the store keeps the editing
      // session's bracket open across it.
      if (edit && sel !== null && ctx.charAtPoint(e.doc) === sel) {
        press = { kind: "char", start: e, base: ctx.charOffset() };
        lastTap = null;
        ctx.beginGesture();
        return;
      }
      const id = titleAt(ctx, e);
      if (id === null) {
        lastTap = null;
        // Leaving is all a click outside does; the next click places (spec M22 §3).
        if (edit) {
          press = null;
          ctx.endTextEdit();
        } else {
          press = { kind: "place", start: e };
        }
        return;
      }
      const tap = { id, time: e.time };
      const second = isDoubleTap(lastTap, tap);
      lastTap = second ? null : tap;
      if (!edit || edit.id !== id) {
        ctx.beginTextEdit(id, e.doc);
        press = { kind: "text", start: e, index: ctx.textIndexAt(e.doc) };
        return;
      }
      const index = ctx.textIndexAt(e.doc);
      if (index === null) {
        press = null;
        return;
      }
      if (second) {
        const w = ctx.textWordAt(index);
        ctx.setTextSelection(w.start, w.end);
        press = null;
      } else if (e.mods.shift) {
        ctx.setTextSelection(edit.anchor, index);
        press = { kind: "text", start: e, index: edit.anchor };
      } else {
        ctx.setTextSelection(index, index);
        press = { kind: "text", start: e, index };
      }
    },

    move(ctx: ToolContext, e: ToolEvent) {
      const p = press;
      if (p?.kind === "text") dragSelect(ctx, p, e);
      if (p?.kind !== "char" || !movedEnough(p.start.screen, e.screen)) return;
      ctx.setCharOffset(
        p.base.dx + (e.doc.x - p.start.doc.x),
        p.base.dy + (e.doc.y - p.start.doc.y),
      );
    },

    up(ctx: ToolContext, e: ToolEvent) {
      const p = press;
      press = null;
      if (!p) return;
      // A click, not a drag — the project's one threshold, shared with select and the shape tools.
      const moved = movedEnough(p.start.screen, e.screen);
      if (p.kind === "char") {
        // Land the character exactly where the pointer was released. `move` is not guaranteed to
        // fire at the final position — the browser coalesces moves, and the last one can be well
        // behind the release point — so without this the letter stops short of where it was
        // dropped, by however much the last move lagged.
        if (moved) {
          ctx.setCharOffset(
            p.base.dx + (e.doc.x - p.start.doc.x),
            p.base.dy + (e.doc.y - p.start.doc.y),
          );
        }
        ctx.finishCharDrag();
        if (!moved) {
          // A click on the selected character that never dragged is an ordinary click in the text.
          const i = ctx.textIndexAt(e.doc);
          if (i !== null) ctx.setTextSelection(i, i);
        }
        return;
      }
      if (p.kind === "text") {
        dragSelect(ctx, p, e);
        return;
      }
      if (!moved) ctx.placeTitle(e.doc);
    },

    cancel(ctx: ToolContext) {
      if (press?.kind === "char") ctx.finishCharDrag();
      press = null;
    },

    keydown(ctx, key) {
      seen = ctx;
      if (key !== "escape" || !ctx.textEdit()) return false;
      ctx.endTextEdit();
      return true;
    },

    busy() {
      return seen?.textEdit() != null;
    },
  };
}
