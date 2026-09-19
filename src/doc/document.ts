import type { Mat } from "../geom/mat";
import type { Vec } from "../geom/vec";

/** The document is plain, immutable data: every edit returns a new object and never mutates its
 *  input. That is what lets undo keep references instead of clones. */

export const DOC_VERSION = 1;
export const MAX_ARTBOARD = 100000;
export const MIN_SIDES = 3;
export const MAX_SIDES = 32;
export const MIN_INNER = 0.1;
export const MAX_INNER = 0.95;

export type Paint = { color: string /* #rrggbb, lowercase */; opacity: number };
export type LineCap = "butt" | "round" | "square";
export type LineJoin = "miter" | "round" | "bevel";

export type Style = {
  fill: Paint | null;
  stroke: Paint | null;
  strokeWidth: number;
  cap: LineCap;
  join: LineJoin;
  opacity: number;
};

export type NodeType = "corner" | "smooth" | "symmetric";

/** Handles are absolute document coordinates (in the shape's own space); null = no handle. */
export type PathNode = { p: Vec; in: Vec | null; out: Vec | null; type: NodeType };
export type Subpath = { nodes: PathNode[]; closed: boolean };

/** Absent means normal — a node carries a flag only in its `true` state, so "not hidden" has
 *  exactly one representation and a no-op edit can return the same reference (spec M9 §3). */
type NodeFlags = { hidden?: true; locked?: true };

type ShapeBase = { id: string; name?: string; transform: Mat; style: Style } & NodeFlags;
export type RectShape = ShapeBase & {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  rx: number;
};
export type EllipseShape = ShapeBase & {
  kind: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
};
/** Spec (M2c) §2. Corners sit on the ellipse (rx, ry); rotation lives in `transform`. */
export type PolygonShape = ShapeBase & {
  kind: "polygon";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Integer MIN_SIDES–MAX_SIDES; for a star, the number of points. */
  sides: number;
  star: boolean;
  /** MIN_INNER–MAX_INNER; kept while `star` is off. */
  innerRatio: number;
};
export type PathShape = ShapeBase & { kind: "path"; subpaths: Subpath[] };
export type Shape = RectShape | EllipseShape | PolygonShape | PathShape;

export type Group = NodeFlags & {
  kind: "group";
  id: string;
  name?: string;
  transform: Mat;
  opacity: number;
  children: Node[];
};
export type Node = Group | Shape;

/** Nothing reads `hidden`/`locked` directly (spec M9 §3). */
export const isHidden = (n: Node): boolean => n.hidden === true;
export const isLocked = (n: Node): boolean => n.locked === true;

export type Layer = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  children: Node[];
};

export type Artboard = { w: number; h: number; background: Paint | null };

export type Doc = {
  version: typeof DOC_VERSION;
  artboard: Artboard;
  layers: Layer[];
  nextId: number;
};

export const DEFAULT_STYLE: Style = {
  fill: { color: "#d9d9d9", opacity: 1 },
  stroke: { color: "#000000", opacity: 1 },
  strokeWidth: 1,
  cap: "butt",
  join: "miter",
  opacity: 1,
};

export function idFor(n: number): string {
  return `n${n}`;
}

export function createDoc(w: number, h: number): Doc {
  return {
    version: DOC_VERSION,
    artboard: { w, h, background: { color: "#ffffff", opacity: 1 } },
    layers: [{ id: idFor(1), name: "Layer 1", visible: true, locked: false, children: [] }],
    nextId: 2,
  };
}

export function isValidArtboardSize(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 && n <= MAX_ARTBOARD;
}
