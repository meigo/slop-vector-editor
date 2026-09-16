import {
  DEFAULT_STYLE,
  type LineCap,
  type LineJoin,
  type Paint,
  type Style,
} from "../doc/document";

export type PolygonPrefs = { sides: number; star: boolean; innerRatio: number };
export type Prefs = { style: Style; polygon: PolygonPrefs };
export type PrefStorage = Pick<Storage, "getItem" | "setItem">;

export const DEFAULT_PREFS: Prefs = {
  style: DEFAULT_STYLE,
  polygon: { sides: 5, star: false, innerRatio: 0.5 },
};

const KEY = "slop-vector-editor:prefs";
const CAPS: readonly string[] = ["butt", "round", "square"];
const JOINS: readonly string[] = ["miter", "round", "bevel"];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function num(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}

function paint(v: unknown, fallback: Paint | null): Paint | null {
  if (v === null) return null;
  if (!isObj(v) || typeof v.color !== "string" || !/^#[0-9a-f]{6}$/.test(v.color)) return fallback;
  return { color: v.color, opacity: num(v.opacity, 0, 1, 1) };
}

/** Preferences come from localStorage, so every field is checked on its own. */
export function sanitizePrefs(raw: unknown): Prefs {
  const r = isObj(raw) ? raw : {};
  const s = isObj(r.style) ? r.style : {};
  const p = isObj(r.polygon) ? r.polygon : {};
  const d = DEFAULT_PREFS;
  return {
    style: {
      fill: "fill" in s ? paint(s.fill, d.style.fill) : d.style.fill,
      stroke: "stroke" in s ? paint(s.stroke, d.style.stroke) : d.style.stroke,
      strokeWidth: num(s.strokeWidth, 0, 1000, d.style.strokeWidth),
      cap: typeof s.cap === "string" && CAPS.includes(s.cap) ? (s.cap as LineCap) : d.style.cap,
      join:
        typeof s.join === "string" && JOINS.includes(s.join) ? (s.join as LineJoin) : d.style.join,
      opacity: num(s.opacity, 0, 1, d.style.opacity),
    },
    polygon: {
      sides: Number.isInteger(p.sides) ? num(p.sides, 3, 32, d.polygon.sides) : d.polygon.sides,
      star: typeof p.star === "boolean" ? p.star : d.polygon.star,
      innerRatio: num(p.innerRatio, 0.1, 0.95, d.polygon.innerRatio),
    },
  };
}

function defaultStorage(): PrefStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadPrefs(storage: PrefStorage | null = defaultStorage()): Prefs {
  if (!storage) return DEFAULT_PREFS;
  try {
    const text = storage.getItem(KEY);
    return text ? sanitizePrefs(JSON.parse(text)) : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: Prefs, storage: PrefStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Blocked or full storage: preferences are a convenience, never an error.
  }
}
