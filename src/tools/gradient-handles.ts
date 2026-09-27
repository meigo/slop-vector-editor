import { isGradient, type Doc, type Paint } from "../doc/document";
import type { PaintSlot } from "../doc/paint-edit";
import { findNode, shapesWithWorld } from "../doc/tree";
import { applyMat, type Mat } from "../geom/mat";
import type { Vec } from "../geom/vec";

/** Spec M15 §7: the one function the Overlay draws from and the tool hit-tests against, so the
 *  two can never disagree (the gizmo's rule, invariant 14). Points are in document space. */
export type GradientHandle = {
  id: string;
  from: Vec;
  to: Vec;
  start: Paint;
  end: Paint;
  world: Mat;
};

export function gradientHandles(
  doc: Doc,
  ids: readonly string[],
  which: PaintSlot,
): GradientHandle[] {
  const out: GradientHandle[] = [];
  for (const id of ids) {
    const found = findNode(doc, id);
    if (!found) continue;
    for (const { shape, world } of shapesWithWorld(found.node, found.parent)) {
      const f = shape.style[which];
      if (!isGradient(f)) continue;
      out.push({
        id: shape.id,
        from: applyMat(world, f.from),
        to: applyMat(world, f.to),
        start: f.start,
        end: f.end,
        world,
      });
    }
  }
  return out;
}

export type HandlePick = { h: GradientHandle; part: "start" | "end" | "line" } | null;

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

function toSegment(p: Vec, a: Vec, b: Vec): number {
  const v = { x: b.x - a.x, y: b.y - a.y };
  const vv = v.x * v.x + v.y * v.y;
  const t = vv === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * v.x + (p.y - a.y) * v.y) / vv));
  return dist(p, { x: a.x + v.x * t, y: a.y + v.y * t });
}

/** Knobs first, across every handle, then lines — a knob sits on its own line, and the first hit
 *  in document order wins, as `hitTest` does. */
export function pickHandle(handles: readonly GradientHandle[], p: Vec, tol: number): HandlePick {
  for (const h of handles) {
    if (dist(h.from, p) <= tol) return { h, part: "start" };
    if (dist(h.to, p) <= tol) return { h, part: "end" };
  }
  for (const h of handles) if (toSegment(p, h.from, h.to) <= tol) return { h, part: "line" };
  return null;
}
