import { boxFromPoints, type Box } from "../geom/box";
import { applyMat, type Mat } from "../geom/mat";
import { dist, mid, type Vec } from "../geom/vec";

/** screen = R(rotation) · doc · zoom + (x, y); screen is CSS px relative to the canvas element.
 *  `rotation` is radians, positive clockwise on screen (y down); absent means 0 and a view that
 *  never rotated keeps no key. */
export type View = { x: number; y: number; zoom: number; rotation?: number };

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;
/** Rotation within this of a quarter turn snaps to it. */
export const SNAP_ANGLE = (3 * Math.PI) / 180;

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function viewAngle(v: View): number {
  return v.rotation ?? 0;
}

/** Into (−π, π]. */
export function normalizeAngle(a: number): number {
  const r = a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  return r <= -Math.PI ? r + 2 * Math.PI : r;
}

/** A view with the given parts; a zero angle leaves no `rotation` key. */
function made(x: number, y: number, zoom: number, rotation: number): View {
  return rotation === 0 ? { x, y, zoom } : { x, y, zoom, rotation };
}

/** document → screen. */
export function viewMatrix(v: View): Mat {
  const a = viewAngle(v);
  const c = Math.cos(a) * v.zoom;
  const s = Math.sin(a) * v.zoom;
  return [c, s, -s, c, v.x, v.y];
}

export function docToScreen(v: View, p: Vec): Vec {
  if (!v.rotation) return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y };
  return applyMat(viewMatrix(v), p);
}

export function screenToDoc(v: View, p: Vec): Vec {
  if (!v.rotation) return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
  const c = Math.cos(v.rotation);
  const s = Math.sin(v.rotation);
  const dx = p.x - v.x;
  const dy = p.y - v.y;
  return { x: (dx * c + dy * s) / v.zoom, y: (dy * c - dx * s) / v.zoom };
}

export function panBy(v: View, dx: number, dy: number): View {
  return { ...v, x: v.x + dx, y: v.y + dy };
}

export function zoomAt(v: View, screen: Vec, factor: number): View {
  const zoom = clampZoom(v.zoom * factor);
  const d = screenToDoc(v, screen);
  const c = Math.cos(viewAngle(v));
  const s = Math.sin(viewAngle(v));
  if (!v.rotation) return { x: screen.x - d.x * zoom, y: screen.y - d.y * zoom, zoom };
  return {
    ...v,
    x: screen.x - zoom * (d.x * c - d.y * s),
    y: screen.y - zoom * (d.x * s + d.y * c),
    zoom,
  };
}

/** Rotate by `delta` radians keeping the screen point `screen` fixed; the angle is normalised. */
export function rotateAt(v: View, screen: Vec, delta: number): View {
  const d = screenToDoc(v, screen);
  const a = normalizeAngle(viewAngle(v) + delta);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return made(
    screen.x - v.zoom * (d.x * c - d.y * s),
    screen.y - v.zoom * (d.x * s + d.y * c),
    v.zoom,
    a,
  );
}

/** `a` itself, or the nearest quarter turn (exact, normalised) when within `snap` of one. */
export function snappedRotation(a: number, snap = SNAP_ANGLE): number {
  const n = normalizeAngle(a);
  const target = Math.round(n / (Math.PI / 2)) * (Math.PI / 2);
  return Math.abs(n - target) <= snap ? normalizeAngle(target) + 0 : a;
}

/** The next multiple of `step` strictly beyond `a` in direction `dir`, normalised. */
export function steppedRotation(a: number, step: number, dir: 1 | -1): number {
  const n = a / step;
  const k = dir === 1 ? Math.floor(n + 1e-9) + 1 : Math.ceil(n - 1e-9) - 1;
  return normalizeAngle(k * step) + 0;
}

/** Fits the rect's turned screen bounding box, centred, at `rotation`. */
export function fitRect(
  rect: { x: number; y: number; w: number; h: number },
  viewW: number,
  viewH: number,
  margin = 40,
  rotation = 0,
): View {
  if (rotation === 0) {
    const zoom = clampZoom(Math.min((viewW - 2 * margin) / rect.w, (viewH - 2 * margin) / rect.h));
    return {
      x: (viewW - rect.w * zoom) / 2 - rect.x * zoom,
      y: (viewH - rect.h * zoom) / 2 - rect.y * zoom,
      zoom,
    };
  }
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const bw = Math.abs(rect.w * c) + Math.abs(rect.h * s);
  const bh = Math.abs(rect.w * s) + Math.abs(rect.h * c);
  const zoom = clampZoom(Math.min((viewW - 2 * margin) / bw, (viewH - 2 * margin) / bh));
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return made(
    viewW / 2 - zoom * (cx * c - cy * s),
    viewH / 2 - zoom * (cx * s + cy * c),
    zoom,
    rotation,
  );
}

/** Zoom and twist about the first midpoint by the change in the pair's length and angle, then pan
 *  by the midpoint's travel. */
export function pinch(v: View, a0: Vec, b0: Vec, a1: Vec, b1: Vec): View {
  const m0 = mid(a0, b0);
  const m1 = mid(a1, b1);
  const d0 = dist(a0, b0);
  const factor = d0 > 0 ? dist(a1, b1) / d0 : 1;
  const twist =
    d0 > 0 && dist(a1, b1) > 0
      ? Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x)
      : 0;
  const zoomed = zoomAt(v, m0, factor);
  const turned = twist === 0 ? zoomed : rotateAt(zoomed, m0, twist);
  return panBy(turned, m1.x - m0.x, m1.y - m0.y);
}

export type WheelLike = {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
};

export function wheelView(v: View, e: WheelLike, at: Vec): View {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const dx = e.deltaX * unit;
  const dy = e.deltaY * unit;
  // Ctrl/Cmd-wheel: exp(−dy / 100), which follows a trackpad pinch's small deltas; each event is
  // capped at ±10 px so one mouse notch (~100 px in Chrome, 3 lines in Firefox) zooms ~10%, not
  // ×2.7 (slop-paint 4bd2825).
  if (e.ctrlKey || e.metaKey)
    return zoomAt(v, at, Math.exp(-Math.max(-10, Math.min(10, dy)) / 100));
  return panBy(v, -dx, -dy);
}

/** The smallest pan that brings `rect` (screen px), grown by `margin`, inside `visible` (screen
 *  px); the same view object when it is already inside. Where it cannot fit, top/left win. */
export function revealPan(view: View, rect: Box, visible: Box, margin: number): View {
  const axis = (pos: number, size: number, vPos: number, vSize: number): number => {
    const lo = pos - margin;
    const hi = pos + size + margin;
    let d = 0;
    if (hi > vPos + vSize) d = vPos + vSize - hi;
    if (lo + d < vPos) d = vPos - lo;
    return d;
  };
  const dx = axis(rect.x, rect.w, visible.x, visible.w);
  const dy = axis(rect.y, rect.h, visible.y, visible.h);
  return dx === 0 && dy === 0 ? view : panBy(view, dx, dy);
}

/** The canvas viewport, as the document-space bounding box of its four corners; on a turned view
 *  the two opposite corners alone give a wrong (even negative-sized) box. */
export function visibleDocBox(view: View, w: number, h: number): Box {
  const box = boxFromPoints(
    [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ].map((p) => screenToDoc(view, p)),
  );
  return box as Box;
}
