import { dist, mid, type Vec } from "../geom/vec";

/** screen = doc · zoom + (x, y); screen is CSS px relative to the canvas element. */
export type View = { x: number; y: number; zoom: number };

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function docToScreen(v: View, p: Vec): Vec {
  return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y };
}

export function screenToDoc(v: View, p: Vec): Vec {
  return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
}

export function panBy(v: View, dx: number, dy: number): View {
  return { x: v.x + dx, y: v.y + dy, zoom: v.zoom };
}

export function zoomAt(v: View, screen: Vec, factor: number): View {
  const zoom = clampZoom(v.zoom * factor);
  const d = screenToDoc(v, screen);
  return { x: screen.x - d.x * zoom, y: screen.y - d.y * zoom, zoom };
}

export function fitRect(
  rect: { x: number; y: number; w: number; h: number },
  viewW: number,
  viewH: number,
  margin = 40,
): View {
  const zoom = clampZoom(Math.min((viewW - 2 * margin) / rect.w, (viewH - 2 * margin) / rect.h));
  return {
    x: (viewW - rect.w * zoom) / 2 - rect.x * zoom,
    y: (viewH - rect.h * zoom) / 2 - rect.y * zoom,
    zoom,
  };
}

export function pinch(v: View, a0: Vec, b0: Vec, a1: Vec, b1: Vec): View {
  const m0 = mid(a0, b0);
  const m1 = mid(a1, b1);
  const d0 = dist(a0, b0);
  const factor = d0 > 0 ? dist(a1, b1) / d0 : 1;
  return panBy(zoomAt(v, m0, factor), m1.x - m0.x, m1.y - m0.y);
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
  if (e.ctrlKey || e.metaKey) return zoomAt(v, at, Math.exp(-dy * 0.01));
  return panBy(v, -dx, -dy);
}
