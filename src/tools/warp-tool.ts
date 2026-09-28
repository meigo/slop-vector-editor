import type { Doc } from "../doc/document";
import { droppedLive, warpNodes, warpRefusal } from "../doc/warp-edit";
import type { Box } from "../geom/box";
import { hitTest } from "../geom/hit";
import type { Vec } from "../geom/vec";
import { identityCage, type Cage } from "../geom/warp";
import { handleCorner, moveCagePart, pickCage, type CagePart } from "./cage-handles";
import { selectionBounds } from "./frame";
import { constrain45 } from "./shape-tools";
import { pointerTolerance, type Tool, type ToolContext, type ToolEvent } from "./tool";

/** Spec M14 §5 as amended by the plan's controller rulings: bends the selection through a
 *  12-point Coons cage and bakes the result into the document.
 *
 *  | Input                      | What happens                                                    |
 *  | -------------------------- | --------------------------------------------------------------- |
 *  | activate / selection change| An identity cage over the selection's world bounds; an empty or |
 *  |                            | degenerate selection stays in the tool with an info notice      |
 *  |                            | (ruling 3). No gesture bracket yet.                             |
 *  | press on a corner/handle   | Corners before handles, nearest within `pointerTolerance / zoom`|
 *  |                            | (ruling 5). The FIRST drag of a cage opens the bracket and      |
 *  |                            | records `base` (ruling 2).                                      |
 *  | drag                       | A corner carries its two near handles; a handle moves alone     |
 *  |                            | (ruling 4). Shift: 45° — a handle about its corner, a corner    |
 *  |                            | about where the drag started. Every frame commits               |
 *  |                            | `warpNodes(base, …)` — never from the current doc (inv. 15).    |
 *  | press anywhere else        | Applies the warp, then selects what is under the press (or      |
 *  |                            | nothing) and re-seeds a cage on the new selection.              |
 *  | Enter (also a tool change, | Closes the bracket — all drags of this cage are ONE undo step — |
 *  |  which sends Enter)        | notices any live shape that became a path, re-seeds.            |
 *  | `settle` (store hook)      | The same commit, but SILENT — no "Warped — …" notice and no     |
 *  |                            | refusal notice.                                                 |
 *  | Escape                     | Restores `base`, closes the bracket (no undo step), back to     |
 *  |                            | Select.                                                         |
 *  | `cancel` (pointercancel)   | Ends the drag only; the cage and its bracket stay — a palm is   |
 *  |                            | not a decision (the pen's rule, invariant 33).                  |
 *  | `discard` (undo/redo/open) | Hides the cage and marks it stale; the store already settled any |
 *  |                            | bracket. The next hover or press re-seeds on the new document.  |
 *
 *  **Notices come only from what the user chose.** The "Warped — …" notice is raised by Enter and
 *  by a press elsewhere, never by `settle`: the store calls `settle` from `cancelActiveGesture`
 *  just before undo, redo and replacing the document too, and a notice about a warp that is about
 *  to be reverted or thrown away is noise — the tool cannot tell those apart from a colour change,
 *  so the store path is silent for all of them. Likewise a refusal ("select something with width
 *  and height") comes only from `activate`, Enter and a press; a re-seed from `hover` or `settle`
 *  is quiet.
 *
 *  `settle` is called by the store from `cancelActiveGesture` and `setSelection`, so it must never
 *  reach either: it only commits, ends the gesture and sets the overlay. */

type Session = {
  ids: readonly string[];
  box: Box;
  cage: Cage;
  /** Non-null while the gesture bracket is open. */
  base: Doc | null;
  /** The document the cage was seeded on. An idle cage whose document has changed since (a nudge
   *  or delete runs `settle` BEFORE its edit) is re-seeded before it is used or hovered. `null`
   *  after `discard`: stale, never equal to a document, so the next hover or press re-seeds. */
  seededOn: Doc | null;
};

type Drag = { part: CagePart; start: Vec; startCage: Cage };

export function createWarpTool(): Tool {
  let session: Session | null = null;
  let drag: Drag | null = null;

  function seed(ctx: ToolContext, quiet: boolean): void {
    const doc = ctx.doc();
    const ids = ctx.selection();
    const refusal = warpRefusal(doc, ids);
    const box = refusal ? null : selectionBounds(doc, ids);
    if (!box) {
      session = null;
      ctx.setOverlay(null);
      if (refusal && ids.length > 0 && !quiet) ctx.notify("info", refusal);
      return;
    }
    const cage = identityCage(box);
    session = { ids, box, cage, base: null, seededOn: doc };
    ctx.setOverlay({ kind: "cage", cage });
  }

  /** Re-seeds an idle cage whose document changed under it; a cage mid-warp is left alone. */
  function fresh(ctx: ToolContext, quiet: boolean): void {
    if (session && session.base === null && session.seededOn !== ctx.doc()) seed(ctx, quiet);
  }

  /** Closes an open bracket, keeping the warp as one undo step; `report` raises the notice. */
  function close(ctx: ToolContext, report: boolean): void {
    if (session?.base) {
      const before = session.base;
      ctx.endGesture();
      const msg = report ? droppedLive(before, ctx.doc(), session.ids) : null;
      if (msg) ctx.notify("info", msg);
    }
    drag = null;
  }

  function settle(ctx: ToolContext): void {
    close(ctx, false);
    seed(ctx, true);
  }

  function apply(ctx: ToolContext, e: ToolEvent): void {
    if (!session?.base || !drag) return;
    const d = drag;
    let to = e.doc;
    if (e.mods.shift) {
      const pivot =
        d.part.kind === "handle" ? handleCorner(d.startCage, d.part.edge, d.part.j) : d.start;
      to = constrain45(pivot, e.doc);
    }
    session.cage = moveCagePart(d.startCage, d.part, to, d.start);
    ctx.setOverlay({ kind: "cage", cage: session.cage });
    ctx.commit(warpNodes(session.base, session.ids, session.cage, session.box));
  }

  const tolerance = (ctx: ToolContext, e: ToolEvent) =>
    pointerTolerance(e.pointerType) / ctx.view().zoom;

  return {
    id: "warp",
    hint: "Drag a corner or handle to bend the selection · Enter to apply · Esc to cancel · Shift: 45°",
    cursor: "crosshair",

    activate(ctx) {
      seed(ctx, false);
      if (ctx.selection().length === 0) ctx.notify("info", "Warp — select something to warp");
    },

    down(ctx, e) {
      const tol = tolerance(ctx, e);
      ctx.setHoverCursor(null);
      fresh(ctx, false);
      const part = session ? pickCage(session.cage, e.doc, tol) : null;
      if (session && part) {
        if (session.base === null) {
          session.base = ctx.doc();
          ctx.beginGesture();
        }
        drag = { part, start: e.doc, startCage: session.cage };
        return;
      }
      close(ctx, true);
      const hit = hitTest(ctx.doc(), e.doc, tol, ctx.enteredGroupId());
      // Re-enters `settle` through the store's hook, which re-seeds quietly; seeding again here is
      // idempotent and is what lets a press on something unwarpable say why.
      ctx.setSelection(hit ? [hit.nodeId] : []);
      seed(ctx, false);
    },

    move(ctx, e) {
      apply(ctx, e);
    },

    up(ctx, e) {
      apply(ctx, e);
      drag = null;
    },

    cancel() {
      drag = null;
    },

    settle,

    keydown(ctx, key) {
      if (key === "enter") {
        close(ctx, true);
        seed(ctx, false);
        return true;
      }
      if (key === "escape") {
        if (session?.base) {
          ctx.commit(session.base);
          ctx.endGesture();
        }
        session = null;
        drag = null;
        ctx.setOverlay(null);
        ctx.setTool("select");
        return true;
      }
      return false;
    },

    busy() {
      return session !== null;
    },

    discard(ctx) {
      if (session) session = { ...session, base: null, seededOn: null };
      drag = null;
      ctx.setOverlay(null);
    },

    hover(ctx, e) {
      fresh(ctx, true);
      const hit = session !== null && pickCage(session.cage, e.doc, tolerance(ctx, e)) !== null;
      ctx.setHoverCursor(hit ? "move" : null);
    },
  };
}
