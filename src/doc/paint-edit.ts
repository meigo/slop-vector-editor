import { nodeBounds } from "../geom/bounds";
import { applyMat, IDENTITY, invert, multiply, type Mat } from "../geom/mat";
import type { Vec } from "../geom/vec";
import {
  DEFAULT_STYLE,
  flatIfDegenerate,
  isGradient,
  sameFill,
  type Doc,
  type Fill,
  type LinearGradient,
  type Node,
  type Paint,
  type Shape,
} from "./document";
import { mapNodes } from "./tree";

/** Spec M15 §6–§7: the gradient edits. Each maps shape by shape, so no shape is ever handed
 *  another shape's coordinates. */

export type PaintSlot = "fill" | "stroke";
export type StopEnd = "start" | "end";

function withFill(s: Shape, which: PaintSlot, f: Fill | null): Shape {
  return sameFill(s.style[which], f) ? s : { ...s, style: { ...s.style, [which]: f } };
}

/** Maps every shape under `ids`, groups descended, with each shape's world matrix. */
function mapShapesWorld(
  doc: Doc,
  ids: readonly string[],
  fn: (s: Shape, world: Mat) => Shape,
): Doc {
  const walk = (n: Node, parent: Mat): Node => {
    const world = multiply(parent, n.transform);
    if (n.kind !== "group") return fn(n, world);
    let changed = false;
    const children = n.children.map((c) => {
      const m = walk(c, world);
      if (m !== c) changed = true;
      return m;
    });
    return changed ? { ...n, children } : n;
  };
  return mapNodes(doc, ids, walk);
}

/** A fade from the paint to the same colour at opacity 0: the most common first gradient, and
 *  one that is visibly a gradient (spec M15 ruling 5). */
const fadeOf = (p: Paint, from: Vec, to: Vec): LinearGradient => ({
  kind: "linear",
  from,
  to,
  start: p,
  end: { ...p, opacity: 0 },
});

export function setPaintKind(
  doc: Doc,
  ids: readonly string[],
  which: PaintSlot,
  kind: "flat" | "linear",
): Doc {
  return mapShapesWorld(doc, ids, (s) => {
    const f = s.style[which];
    if (f === null) return s;
    if (kind === "flat") return isGradient(f) ? withFill(s, which, f.start) : s;
    if (isGradient(f)) return s;
    const box = nodeBounds({ ...s, transform: IDENTITY }, IDENTITY);
    if (!box || (box.w <= 0 && box.h <= 0)) return s;
    // A zero-width shape (a vertical line) has no horizontal mid-line to fade across, but it does
    // have a vertical one — lay the default line along it instead of silently doing nothing
    // (review finding 3).
    const [from, to] =
      box.w > 0
        ? [
            { x: box.x, y: box.y + box.h / 2 },
            { x: box.x + box.w, y: box.y + box.h / 2 },
          ]
        : [
            { x: box.x, y: box.y },
            { x: box.x, y: box.y + box.h },
          ];
    return withFill(s, which, fadeOf(f, from, to));
  });
}

export function setGradientStop(
  doc: Doc,
  ids: readonly string[],
  which: PaintSlot,
  stop: StopEnd,
  paint: Paint,
): Doc {
  return mapShapesWorld(doc, ids, (s) => {
    const f = s.style[which];
    return isGradient(f) ? withFill(s, which, { ...f, [stop]: paint }) : s;
  });
}

/** `from`/`to` in the shape's own space; used by the tool's knob and line drags. */
export function setGradientPoints(doc: Doc, id: string, which: PaintSlot, from: Vec, to: Vec): Doc {
  return mapNodes(doc, [id], (n) => {
    if (n.kind === "group") return n;
    const f = n.style[which];
    return isGradient(f) ? withFill(n, which, flatIfDegenerate({ ...f, from, to })) : n;
  });
}

/** One document-space line mapped into every shape under `ids`, so a line drawn across several
 *  shapes reads as one continuous gradient (spec M15 §7). */
export function drawGradientLine(
  doc: Doc,
  ids: readonly string[],
  which: PaintSlot,
  from: Vec,
  to: Vec,
): Doc {
  return mapShapesWorld(doc, ids, (s, world) => {
    const inv = invert(world);
    if (!inv) return s;
    const a = applyMat(inv, from);
    const b = applyMat(inv, to);
    const f = s.style[which];
    const next: LinearGradient = isGradient(f)
      ? { ...f, from: a, to: b }
      : fadeOf(f ?? (DEFAULT_STYLE[which] as Paint), a, b);
    return withFill(s, which, flatIfDegenerate(next));
  });
}
