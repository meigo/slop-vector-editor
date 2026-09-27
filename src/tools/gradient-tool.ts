import type { Doc } from "../doc/document";
import { drawGradientLine, setGradientPoints } from "../doc/paint-edit";
import { hitTest } from "../geom/hit";
import { applyMat, invert } from "../geom/mat";
import type { Vec } from "../geom/vec";
import { gradientHandles, pickHandle, type GradientHandle } from "./gradient-handles";
import { SNAP_45 } from "./shape-tools";
import { movedEnough, pointerTolerance, type Tool, type ToolContext, type ToolEvent } from "./tool";

/** Spec M15 §7: draws and adjusts the target paint's gradient on the selected shapes. */

type Mode =
  | { kind: "pending"; start: ToolEvent; pick: ReturnType<typeof pickHandle> }
  | { kind: "knob"; base: Doc; h: GradientHandle; end: "start" | "end" }
  | { kind: "line"; base: Doc; h: GradientHandle; start: Vec }
  | { kind: "draw"; base: Doc; ids: readonly string[]; start: Vec };

/** Shift: the moving end rotates about `pivot` to the nearest 45°, keeping its distance. */
function constrain(pivot: Vec, p: Vec, on: boolean): Vec {
  if (!on) return p;
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  const r = Math.hypot(dx, dy);
  const a = Math.round(Math.atan2(dy, dx) / SNAP_45) * SNAP_45;
  return { x: pivot.x + r * Math.cos(a), y: pivot.y + r * Math.sin(a) };
}

function toOwn(h: GradientHandle, p: Vec): Vec | null {
  const inv = invert(h.world);
  return inv ? applyMat(inv, p) : null;
}

function apply(ctx: ToolContext, m: Exclude<Mode, { kind: "pending" }>, e: ToolEvent): void {
  const which = ctx.gradientTarget();
  if (m.kind === "draw") {
    const to = constrain(m.start, e.doc, e.mods.shift);
    ctx.commit(drawGradientLine(m.base, m.ids, which, m.start, to));
    return;
  }
  let from = m.h.from;
  let to = m.h.to;
  if (m.kind === "knob") {
    if (m.end === "start") from = constrain(m.h.to, e.doc, e.mods.shift);
    else to = constrain(m.h.from, e.doc, e.mods.shift);
  } else {
    const dx = e.doc.x - m.start.x;
    const dy = e.doc.y - m.start.y;
    from = { x: from.x + dx, y: from.y + dy };
    to = { x: to.x + dx, y: to.y + dy };
  }
  const a = toOwn(m.h, from);
  const b = toOwn(m.h, to);
  if (!a || !b) return;
  // Commits from the gesture base (invariant 15), so a returning drag restores it exactly.
  ctx.commit(setGradientPoints(m.base, m.h.id, which, a, b));
}

export function createGradientTool(): Tool {
  let mode: Mode | null = null;

  const handles = (ctx: ToolContext) =>
    gradientHandles(ctx.doc(), ctx.selection(), ctx.gradientTarget());

  function cancelMode(ctx: ToolContext): void {
    const m = mode;
    mode = null;
    if (!m || m.kind === "pending") return;
    ctx.commit(m.base);
    ctx.endGesture();
  }

  return {
    id: "gradient",
    hint: "Drag across the selection to draw a gradient · drag a knob or the line to adjust · Shift: 45°",
    cursor: "crosshair",

    down(ctx, e) {
      cancelMode(ctx);
      const tol = pointerTolerance(e.pointerType) / ctx.view().zoom;
      mode = { kind: "pending", start: e, pick: pickHandle(handles(ctx), e.doc, tol) };
    },

    move(ctx, e) {
      if (!mode) return;
      if (mode.kind === "pending") {
        if (!movedEnough(mode.start.screen, e.screen)) return;
        const { pick, start } = mode;
        if (pick) {
          ctx.beginGesture();
          mode =
            pick.part === "line"
              ? { kind: "line", base: ctx.doc(), h: pick.h, start: start.doc }
              : { kind: "knob", base: ctx.doc(), h: pick.h, end: pick.part };
        } else {
          if (ctx.selection().length === 0) {
            const hit = hitTest(
              ctx.doc(),
              start.doc,
              pointerTolerance(start.pointerType) / ctx.view().zoom,
              ctx.enteredGroupId(),
            );
            if (!hit) {
              mode = null;
              return;
            }
            ctx.setSelection([hit.nodeId]);
          }
          ctx.beginGesture();
          mode = { kind: "draw", base: ctx.doc(), ids: ctx.selection(), start: start.doc };
        }
      }
      apply(ctx, mode, e);
    },

    up(ctx, e) {
      const m = mode;
      mode = null;
      if (!m) return;
      if (m.kind === "pending") {
        // A click: a knob picks its stop; anything else selects what is under the press.
        if (m.pick && m.pick.part !== "line") {
          ctx.setGradientStop({ id: m.pick.h.id, stop: m.pick.part, which: ctx.gradientTarget() });
          return;
        }
        if (m.pick) return;
        const hit = hitTest(
          ctx.doc(),
          e.doc,
          pointerTolerance(e.pointerType) / ctx.view().zoom,
          ctx.enteredGroupId(),
        );
        ctx.setSelection(hit ? [hit.nodeId] : []);
        return;
      }
      apply(ctx, m, e);
      ctx.endGesture();
    },

    cancel(ctx) {
      cancelMode(ctx);
    },
  };
}
