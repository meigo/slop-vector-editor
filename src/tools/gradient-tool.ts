import type { Doc, Gradient } from "../doc/document";
import {
  drawGradientLine,
  setGradientGeometry,
  setGradientMid,
  type StopEnd,
} from "../doc/paint-edit";
import { hitTest } from "../geom/hit";
import { applyMat, invert } from "../geom/mat";
import type { Vec } from "../geom/vec";
import {
  gradientHandles,
  pickHandle,
  type GradientHandle,
  type HandlePart,
} from "./gradient-handles";
import { SNAP_45 } from "./shape-tools";
import { movedEnough, pointerTolerance, type Tool, type ToolContext, type ToolEvent } from "./tool";

/** Spec M15 §7, M16 §6: draws and adjusts the target paint's gradient on the selected shapes. */

type Mode =
  | { kind: "pending"; start: ToolEvent; pick: ReturnType<typeof pickHandle> }
  | { kind: "knob"; base: Doc; h: GradientHandle; part: HandlePart }
  | { kind: "line"; base: Doc; h: GradientHandle; start: Vec }
  | { kind: "mid"; base: Doc; h: GradientHandle }
  | { kind: "draw"; base: Doc; ids: readonly string[]; start: Vec };

const sub = (p: Vec, q: Vec) => ({ x: p.x - q.x, y: p.y - q.y });
const add = (p: Vec, q: Vec) => ({ x: p.x + q.x, y: p.y + q.y });
const dot = (p: Vec, q: Vec) => p.x * q.x + p.y * q.y;
const scaleVec = (v: Vec, k: number) => ({ x: v.x * k, y: v.y * k });
function unit(v: Vec): Vec {
  const len = Math.hypot(v.x, v.y);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

/** Shift: the moving end rotates about `pivot` to the nearest 45°, keeping its distance. */
function constrain(pivot: Vec, p: Vec, on: boolean): Vec {
  if (!on) return p;
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  const r = Math.hypot(dx, dy);
  const a = Math.round(Math.atan2(dy, dx) / SNAP_45) * SNAP_45;
  return { x: pivot.x + r * Math.cos(a), y: pivot.y + r * Math.sin(a) };
}

/** Rim A: the similarity about `c` taking the old A to the new one, applied to B as well — the
 *  ellipse turns and grows but keeps its shape (spec M16 §6). */
function similarityB(c: Vec, a0: Vec, a1: Vec, b0: Vec): Vec | null {
  const u = sub(a0, c),
    v = sub(a1, c);
  const uu = u.x * u.x + u.y * u.y;
  if (uu === 0) return null;
  // v = k·u in complex terms: k = v / u.
  const kr = (v.x * u.x + v.y * u.y) / uu,
    ki = (v.y * u.x - v.x * u.y) / uu;
  const w = sub(b0, c);
  return add(c, { x: kr * w.x - ki * w.y, y: kr * w.y + ki * w.x });
}

/** A tap's part maps onto the stop it picks (spec M16 §6): the centre is the start of a linear
 *  drag too, and both rims read like a linear drag's end. */
function stopFor(part: Exclude<HandlePart, "line" | "mid">): StopEnd {
  return part === "center" || part === "start" ? "start" : "end";
}

function toOwnGradient(h: GradientHandle, g: Gradient): Gradient | null {
  const inv = invert(h.world);
  if (!inv) return null;
  return g.kind === "linear"
    ? {
        kind: "linear",
        from: applyMat(inv, g.from),
        to: applyMat(inv, g.to),
        start: g.start,
        end: g.end,
      }
    : {
        kind: "radial",
        center: applyMat(inv, g.center),
        a: applyMat(inv, g.a),
        b: applyMat(inv, g.b),
        start: g.start,
        end: g.end,
      };
}

/** Applies the drag's current geometry and commits it; returns whether it actually committed —
 *  `false` only when a knob/line drag's own-space conversion is singular (`toOwnGradient`), which
 *  is also why `up()` must check this before forgetting anything (fix M16 review finding 1). */
function apply(ctx: ToolContext, m: Exclude<Mode, { kind: "pending" }>, e: ToolEvent): boolean {
  const which = ctx.gradientTarget();
  if (m.kind === "draw") {
    const to = constrain(m.start, e.doc, e.mods.shift);
    ctx.commit(drawGradientLine(m.base, m.ids, which, m.start, to, ctx.gradientType()));
    return true;
  }
  if (m.kind === "mid") {
    // Spec M17 §6: project onto from→to (centre→A for a radial), whole percents, 1–99.
    const [p0, p1] = m.h.kind === "linear" ? [m.h.from, m.h.to] : [m.h.center, m.h.a];
    const d = sub(p1, p0);
    const dd = dot(d, d);
    if (dd === 0) return false;
    const t = dot(sub(e.doc, p0), d) / dd;
    const mid = Math.min(99, Math.max(1, Math.round(t * 100))) / 100;
    ctx.commit(setGradientMid(m.base, [m.h.id], which, mid));
    return true;
  }
  const h = m.h;
  let next: Gradient;
  if (m.kind === "line") {
    // Centre, or either line: translates all three points together (spec M16 §6).
    const delta = { x: e.doc.x - m.start.x, y: e.doc.y - m.start.y };
    next =
      h.kind === "linear"
        ? {
            kind: "linear",
            from: add(h.from, delta),
            to: add(h.to, delta),
            start: h.start,
            end: h.end,
          }
        : {
            kind: "radial",
            center: add(h.center, delta),
            a: add(h.a, delta),
            b: add(h.b, delta),
            start: h.start,
            end: h.end,
          };
  } else if (h.kind === "linear") {
    const from = m.part === "start" ? constrain(h.to, e.doc, e.mods.shift) : h.from;
    const to = m.part === "end" ? constrain(h.from, e.doc, e.mods.shift) : h.to;
    next = { kind: "linear", from, to, start: h.start, end: h.end };
  } else if (m.part === "rimA") {
    // Rotates and scales the whole ellipse about the centre, keeping its shape.
    const a = constrain(h.center, e.doc, e.mods.shift);
    const b = similarityB(h.center, h.a, a, h.b) ?? h.b;
    next = { kind: "radial", center: h.center, a, b, start: h.start, end: h.end };
  } else {
    // Rim B moves alone; Shift keeps it perpendicular to A − centre.
    let b = e.doc;
    if (e.mods.shift) {
      const n = unit(sub(h.a, h.center));
      const perp = { x: -n.y, y: n.x };
      b = add(h.center, scaleVec(perp, dot(sub(e.doc, h.center), perp)));
    }
    next = { kind: "radial", center: h.center, a: h.a, b, start: h.start, end: h.end };
  }
  const own = toOwnGradient(h, next);
  if (!own) return false;
  // Commits from the gesture base (invariant 15), so a returning drag restores it exactly.
  ctx.commit(setGradientGeometry(m.base, h.id, which, own));
  return true;
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
    hint: "Drag across the selection to draw a gradient · drag a knob, the midpoint diamond or a line to adjust · Shift: 45°",
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
            pick.part === "mid"
              ? { kind: "mid", base: ctx.doc(), h: pick.h }
              : pick.part === "line" || pick.part === "center"
                ? { kind: "line", base: ctx.doc(), h: pick.h, start: start.doc }
                : { kind: "knob", base: ctx.doc(), h: pick.h, part: pick.part };
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
        if (m.pick && m.pick.part !== "line" && m.pick.part !== "mid") {
          ctx.setGradientStop({
            id: m.pick.h.id,
            stop: stopFor(m.pick.part),
            which: ctx.gradientTarget(),
          });
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
      const committed = apply(ctx, m, e);
      ctx.endGesture();
      // Once per gesture, and only when it actually committed — a cancelled drag restores the
      // base document instead (fix M16 review finding 1) and never for a midpoint drag (spec M17
      // §6), which changes no geometry.
      if (committed && m.kind !== "mid") {
        ctx.forgetGradients(m.kind === "draw" ? m.ids : [m.h.id], ctx.gradientTarget());
      }
    },

    cancel(ctx) {
      cancelMode(ctx);
    },
  };
}
