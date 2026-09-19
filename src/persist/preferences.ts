import { clampSidebarWidth, DEFAULT_SIDEBAR_PX } from "../lib/panel-layout";
import {
  DEFAULT_STYLE,
  type LineCap,
  type LineJoin,
  type Paint,
  type Style,
} from "../doc/document";

export type PolygonPrefs = { sides: number; star: boolean; innerRatio: number };
export type Prefs = {
  style: Style;
  polygon: PolygonPrefs;
  snap: boolean;
  /** The modifier dock's Shift and Alt latches. `null` means nobody has decided yet, so the dock
   *  may expand itself the first time a finger or a Pencil is used; once it is true or false, that
   *  was a decision — by the user or by that first touch — and nothing overrides it again. */
  dockExpanded: boolean | null;
  /** Properties' share of the sidebar's body; Layers gets the rest (spec M8 §4). */
  splitRatio: number;
  /** The Layers panel's collapse. Unlike Properties, nothing but the user opens or closes it. */
  layersOpen: boolean;
  /** The ids of the properties panel's sections the user has **closed**, so a section absent from
   *  this list is open. Storing the closed ones is what lets a section added in a later release
   *  appear open without a migration, and it keeps the common case — nothing collapsed — an empty
   *  array. `SECTION_IDS` is the whole vocabulary; anything else is dropped on load, so a renamed
   *  section cannot leave a permanently closed ghost in the pref. */
  closedSections: string[];
  /** The sidebar's width in CSS px (spec M10e §3). Clamped, never rejected, on load and on every
   *  window resize — a width saved on a wide monitor must not strand the panel on a laptop. */
  sidebarPx: number;
};

/** Every collapsible section in the properties panel. `randomise` is the one closed by default
 *  (spec M10e §1): a title's text and size are why the panel is open, and the four jitter amounts
 *  are ~200px of what is otherwise a set-once control. */
export const SECTION_IDS = [
  "text",
  "randomise",
  "shape",
  "newPolygons",
  "node",
  "geometry",
] as const;
export type SectionId = (typeof SECTION_IDS)[number];
export const DEFAULT_CLOSED: readonly SectionId[] = ["randomise"];
export type PrefStorage = Pick<Storage, "getItem" | "setItem">;

export const DEFAULT_PREFS: Prefs = {
  style: DEFAULT_STYLE,
  polygon: { sides: 5, star: false, innerRatio: 0.5 },
  snap: true,
  dockExpanded: null,
  splitRatio: 0.55,
  layersOpen: true,
  closedSections: [...DEFAULT_CLOSED],
  sidebarPx: DEFAULT_SIDEBAR_PX,
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
    snap: typeof r.snap === "boolean" ? r.snap : d.snap,
    dockExpanded: typeof r.dockExpanded === "boolean" ? r.dockExpanded : d.dockExpanded,
    // Any fraction of the column is legal here; how small a panel may actually get is a question
    // about pixels, and `clampRatio` is the one that knows the column's height. A window range
    // hard-coded here would silently reject — not clamp — the ratios a tall column produces.
    splitRatio:
      typeof r.splitRatio === "number" &&
      Number.isFinite(r.splitRatio) &&
      r.splitRatio > 0 &&
      r.splitRatio < 1
        ? r.splitRatio
        : d.splitRatio,
    layersOpen: typeof r.layersOpen === "boolean" ? r.layersOpen : d.layersOpen,
    // An absent list means "never saved", which takes the defaults; a present one is the user's
    // decision and is honoured even when empty — that is how "I opened Randomise" persists.
    closedSections: Array.isArray(r.closedSections)
      ? r.closedSections.filter((v): v is SectionId =>
          (SECTION_IDS as readonly string[]).includes(v as string),
        )
      : [...d.closedSections],
    // Clamped, not rejected: the sibling apps all do this, and it is what makes a width stored on
    // a 5K monitor merely narrow on a laptop instead of silently thrown away. The real viewport is
    // not known here — this runs before layout — so the ceiling is applied again on mount and on
    // every window resize; this pass only enforces the floor and rejects nonsense.
    sidebarPx:
      typeof r.sidebarPx === "number" && Number.isFinite(r.sidebarPx)
        ? clampSidebarWidth(r.sidebarPx, Number.MAX_SAFE_INTEGER)
        : d.sidebarPx,
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
