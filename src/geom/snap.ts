import type { Doc } from "../doc/document";
import { nodeBounds } from "./bounds";
import type { Box } from "./box";
import { IDENTITY } from "./mat";
import type { Vec } from "./vec";

/** Snap distance in screen pixels; callers divide by the zoom. */
export const SNAP_PX = 8;

export type SnapTargets = { xs: number[]; ys: number[] };
export type Guides = { xs: number[]; ys: number[] };
export type Axes = { x: boolean; y: boolean };

export const NO_GUIDES: Guides = { xs: [], ys: [] };
const BOTH: Axes = { x: true, y: true };

export function hasGuides(g: Guides): boolean {
  return g.xs.length > 0 || g.ys.length > 0;
}

/** Candidate lines: the artboard's edges and centre, and the bounds of every top-level node on a
 *  visible layer (locked layers included — you can align to what you can't edit). */
export function collectTargets(doc: Doc, exclude: readonly string[]): SnapTargets {
  const skip = new Set(exclude);
  const { w, h } = doc.artboard;
  const xs = [0, w / 2, w];
  const ys = [0, h / 2, h];
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    for (const n of layer.children) {
      if (skip.has(n.id)) continue;
      const b = nodeBounds(n, IDENTITY);
      if (!b) continue;
      xs.push(b.x, b.x + b.w / 2, b.x + b.w);
      ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
  }
  return { xs: xs.sort((a, b) => a - b), ys: ys.sort((a, b) => a - b) };
}

/** The closest (value, target) pair within `threshold`. Ties keep the earlier value, then the
 *  smaller target (targets are ascending). */
export function snapValue(
  values: readonly number[],
  targets: readonly number[],
  threshold: number,
): { delta: number; at: number } | null {
  let best: { delta: number; at: number } | null = null;
  for (const v of values) {
    for (const t of targets) {
      const d = t - v;
      if (Math.abs(d) > threshold) continue;
      if (!best || Math.abs(d) < Math.abs(best.delta)) best = { delta: d, at: t };
    }
  }
  return best;
}

export function snapBox(
  box: Box,
  targets: SnapTargets,
  threshold: number,
  axes: Axes = BOTH,
): { dx: number; dy: number; guides: Guides } {
  const sx = axes.x
    ? snapValue([box.x, box.x + box.w / 2, box.x + box.w], targets.xs, threshold)
    : null;
  const sy = axes.y
    ? snapValue([box.y, box.y + box.h / 2, box.y + box.h], targets.ys, threshold)
    : null;
  return {
    dx: sx?.delta ?? 0,
    dy: sy?.delta ?? 0,
    guides: { xs: sx ? [sx.at] : [], ys: sy ? [sy.at] : [] },
  };
}

export function snapPoint(
  p: Vec,
  targets: SnapTargets,
  threshold: number,
  axes: Axes = BOTH,
): { p: Vec; guides: Guides } {
  const sx = axes.x ? snapValue([p.x], targets.xs, threshold) : null;
  const sy = axes.y ? snapValue([p.y], targets.ys, threshold) : null;
  return {
    p: { x: p.x + (sx?.delta ?? 0), y: p.y + (sy?.delta ?? 0) },
    guides: { xs: sx ? [sx.at] : [], ys: sy ? [sy.at] : [] },
  };
}
