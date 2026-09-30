import type { Box } from "../geom/box";
import type { Vec } from "../geom/vec";
import { docToScreen, type View } from "../state/viewport";
import { frameToDoc, type Frame } from "./frame";
import type { Mods } from "./types";

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type Handle = ResizeHandle | "rotate";

export const RESIZE_HANDLES: readonly ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
export const ROTATE_OFFSET = 24;
export const MIN_SIZE = 0.01;
export const ROTATE_SNAP = Math.PI / 12;

/** The basis of a handle's REACH (`reachOf`) and of the push-outside rule — 16 for touch keeps a
 *  finger's 10px grab. Not how big it is drawn: see `handleDrawSize`. */
export function handleSize(pointerType: string): number {
  return pointerType === "mouse" ? 8 : 16;
}

/** How big a handle is DRAWN (2026-09-30). Touch handles drawn at their 16px reach basis covered a
 *  small object on screen; drawn at 10 they grab exactly as before — the reach is invisible, as in
 *  Procreate, Figma and Affinity on iPad. A mouse's are unchanged. */
export function handleDrawSize(pointerType: string): number {
  return pointerType === "mouse" ? 8 : 10;
}

export function handleFramePoint(h: ResizeHandle, b: Box): Vec {
  const x = h.includes("w") ? b.x : h.includes("e") ? b.x + b.w : b.x + b.w / 2;
  const y = h.includes("n") ? b.y : h.includes("s") ? b.y + b.h : b.y + b.h / 2;
  return { x, y };
}

/** A handle's reach from its centre — the same 6/10px `handleAt` uses. */
const reachOf = (size: number) => size / 2 + 2;

/** Spec (M5) §3: an object shorter than three reaches is covered by its own handles, so every press
 *  resizes it and none moves it. The box is expanded on screen — symmetrically, so the centre and
 *  therefore the resize maths are unchanged — and only for an axis that has a size at all: a zero
 *  axis keeps its handles coincident, which is what leaves a line draggable by its middle. */
function padBox(box: Box, zoom: number, size: number): Box {
  const span = 3 * reachOf(size);
  const grow = (v: number, len: number): [number, number] => {
    const abs = Math.abs(len);
    if (abs === 0 || abs * zoom >= span) return [v, len];
    const d = ((span / zoom - abs) / 2) * (len < 0 ? -1 : 1);
    return [v - d, len + 2 * d];
  };
  const [x, w] = grow(box.x, box.w);
  const [y, h] = grow(box.y, box.h);
  return { x, y, w, h };
}

export function handlePositions(f: Frame, view: View, size?: number): Record<Handle, Vec> {
  const box = size === undefined ? f.box : padBox(f.box, view.zoom, size);
  const out = {} as Record<Handle, Vec>;
  for (const h of RESIZE_HANDLES)
    out[h] = docToScreen(view, frameToDoc(f, handleFramePoint(h, box)));
  out.rotate = {
    x: out.n.x + ROTATE_OFFSET * Math.sin(f.angle),
    y: out.n.y - ROTATE_OFFSET * Math.cos(f.angle),
  };
  return out;
}

export function frameOutline(f: Frame, view: View): Vec[] {
  const h = handlePositions(f, view);
  return [h.nw, h.ne, h.se, h.sw];
}

const PRIORITY: readonly Handle[] = ["rotate", "nw", "ne", "se", "sw", "n", "e", "s", "w"];

/** The resize handles to draw and hit-test: none that would act on a zero-size axis. */
export function activeHandles(f: Frame): readonly ResizeHandle[] {
  const { w, h } = f.box;
  return RESIZE_HANDLES.filter((k) => {
    if (k === "n" || k === "s") return h !== 0;
    if (k === "e" || k === "w") return w !== 0;
    return w !== 0 || h !== 0;
  });
}

/** The two corners each edge midpoint sits between. */
const EDGE: Readonly<Record<"n" | "e" | "s" | "w", [ResizeHandle, ResizeHandle]>> = {
  n: ["nw", "ne"],
  e: ["ne", "se"],
  s: ["se", "sw"],
  w: ["sw", "nw"],
};

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/** The resize handles to draw and hit-test at this zoom (2026-09-30): `activeHandles`, minus the
 *  midpoint of any side shorter on screen than room for four reaches — there it only covered the
 *  object. `handleAt` then lets that whole edge line grab instead. Measured on the positions as
 *  drawn (pushed out for a tiny object), so zooming in brings the midpoints back. */
export function visibleHandles(f: Frame, view: View, size: number): readonly ResizeHandle[] {
  const pos = handlePositions(f, view, size);
  const room = 4 * 2 * reachOf(size);
  return activeHandles(f).filter((h) => {
    if (!(h in EDGE)) return true;
    const [a, b] = EDGE[h as keyof typeof EDGE];
    return dist(pos[a], pos[b]) >= room;
  });
}

/** Distance from `p` to the segment a–b. */
function toSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return dist(p, { x: a.x + dx * t, y: a.y + dy * t });
}

export function handleAt(f: Frame, view: View, screen: Vec, size: number): Handle | null {
  const pos = handlePositions(f, view, size);
  const reach = reachOf(size);
  const active = activeHandles(f);
  const visible: readonly Handle[] = visibleHandles(f, view, size);
  for (const h of PRIORITY) {
    if (h !== "rotate" && !visible.includes(h)) continue;
    const p = pos[h];
    if (Math.abs(p.x - screen.x) <= reach && Math.abs(p.y - screen.y) <= reach) return h;
  }
  // A midpoint hidden on a short side: its whole edge line grabs, as a frame edge does in Figma.
  for (const h of ["n", "e", "s", "w"] as const) {
    if (!active.includes(h) || visible.includes(h)) continue;
    const [a, b] = EDGE[h];
    if (toSegment(screen, pos[a], pos[b]) <= reach) return h;
  }
  return null;
}

const sgn = (v: number) => (v < 0 ? -1 : 1);

/** Signed new size along one axis. `dir` is +1 for the far edge, −1 for the near edge. */
function signedSize(s0: number, size: number, dir: -1 | 0 | 1, p: number, alt: boolean): number {
  if (dir === 0 || size === 0) return size;
  const raw = alt ? 2 * (p - (s0 + size / 2)) * dir : (p - (dir === 1 ? s0 : s0 + size)) * dir;
  return Math.abs(raw) < MIN_SIZE ? sgn(raw) * MIN_SIZE : raw;
}

/** Where the near edge (`s0`) ends up for a new signed size `s`. */
function nearEdge(s0: number, size: number, dir: -1 | 0 | 1, s: number, alt: boolean): number {
  if (dir === 0 || size === 0) return s0;
  if (alt) return s0 + size / 2 - s / 2;
  return dir === 1 ? s0 : s0 + size - s;
}

/** A corner keeps the proportions unless Shift is held; an edge moves its own axis only
 *  (2026-09-30 — it was the other way round, the Figma/Illustrator convention). On iPad Shift is a
 *  latch in the dock, so the common gesture has to be the one that needs no modifier; Keynote,
 *  Procreate and Affinity on iPad scale corners uniformly for the same reason. It also keeps a
 *  title a title: only a uniform resize survives as text (invariant 44). */
export function dragHandle(h: ResizeHandle, start: Box, p: Vec, mods: Mods): Box {
  const dx: -1 | 0 | 1 = h.includes("e") ? 1 : h.includes("w") ? -1 : 0;
  const dy: -1 | 0 | 1 = h.includes("s") ? 1 : h.includes("n") ? -1 : 0;
  let w = signedSize(start.x, start.w, dx, p.x, mods.alt);
  let hh = signedSize(start.y, start.h, dy, p.y, mods.alt);
  if (!mods.shift && dx !== 0 && dy !== 0 && start.w !== 0 && start.h !== 0) {
    const kx = w / start.w;
    const ky = hh / start.h;
    const k = Math.max(Math.abs(kx), Math.abs(ky));
    w = sgn(kx) * k * start.w;
    hh = sgn(ky) * k * start.h;
  }
  return {
    x: nearEdge(start.x, start.w, dx, w, mods.alt),
    y: nearEdge(start.y, start.h, dy, hh, mods.alt),
    w,
    h: hh,
  };
}

export function normalizeAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  else if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

export function rotateDelta(
  centre: Vec,
  start: Vec,
  p: Vec,
  frameAngle: number,
  snap: boolean,
): number {
  let d =
    Math.atan2(p.y - centre.y, p.x - centre.x) - Math.atan2(start.y - centre.y, start.x - centre.x);
  if (snap) d = Math.round((frameAngle + d) / ROTATE_SNAP) * ROTATE_SNAP - frameAngle;
  return normalizeAngle(d);
}
