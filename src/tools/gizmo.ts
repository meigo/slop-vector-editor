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

export function handleSize(pointerType: string): number {
  return pointerType === "mouse" ? 8 : 16;
}

function framePoint(h: ResizeHandle, b: Box): Vec {
  const x = h.includes("w") ? b.x : h.includes("e") ? b.x + b.w : b.x + b.w / 2;
  const y = h.includes("n") ? b.y : h.includes("s") ? b.y + b.h : b.y + b.h / 2;
  return { x, y };
}

export function handlePositions(f: Frame, view: View): Record<Handle, Vec> {
  const out = {} as Record<Handle, Vec>;
  for (const h of RESIZE_HANDLES) out[h] = docToScreen(view, frameToDoc(f, framePoint(h, f.box)));
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

export function handleAt(f: Frame, view: View, screen: Vec, size: number): Handle | null {
  const pos = handlePositions(f, view);
  const reach = size / 2 + 2;
  for (const h of PRIORITY) {
    const p = pos[h];
    if (Math.abs(p.x - screen.x) <= reach && Math.abs(p.y - screen.y) <= reach) return h;
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

export function dragHandle(h: ResizeHandle, start: Box, p: Vec, mods: Mods): Box {
  const dx: -1 | 0 | 1 = h.includes("e") ? 1 : h.includes("w") ? -1 : 0;
  const dy: -1 | 0 | 1 = h.includes("s") ? 1 : h.includes("n") ? -1 : 0;
  let w = signedSize(start.x, start.w, dx, p.x, mods.alt);
  let hh = signedSize(start.y, start.h, dy, p.y, mods.alt);
  if (mods.shift && dx !== 0 && dy !== 0 && start.w !== 0 && start.h !== 0) {
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
