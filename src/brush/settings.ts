/** The Brush tool's settings (spec M21 §6). */
export type BrushPrefs = {
  size: number;
  pressure: number;
  taper: boolean;
  stream: number;
  smooth: number;
};

export const DEFAULT_BRUSH: BrushPrefs = {
  size: 8,
  pressure: 3,
  taper: true,
  stream: 0,
  smooth: 30,
};

export const SIZE_MIN = 0.5;
export const SIZE_MAX = 500;
export const PRESS_MIN = 1;
export const PRESS_MAX = 8;

export function clampSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_BRUSH.size;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, n));
}

/** Half-step snap, then clamp (as slop-paint's `clampPress`). */
export function clampPress(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_BRUSH.pressure;
  return Math.min(PRESS_MAX, Math.max(PRESS_MIN, Math.round(n * 2) / 2));
}

export function clampPercent(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, n));
}

/** Comes from localStorage, so every field is checked on its own. */
export function sanitizeBrush(raw: unknown): BrushPrefs {
  const r =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const d = DEFAULT_BRUSH;
  return {
    size: typeof r.size === "number" ? clampSize(r.size) : d.size,
    pressure: typeof r.pressure === "number" ? clampPress(r.pressure) : d.pressure,
    taper: typeof r.taper === "boolean" ? r.taper : d.taper,
    stream: typeof r.stream === "number" ? clampPercent(r.stream, d.stream) : d.stream,
    smooth: typeof r.smooth === "number" ? clampPercent(r.smooth, d.smooth) : d.smooth,
  };
}
