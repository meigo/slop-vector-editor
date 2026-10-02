import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type EllipseShape,
  type Group,
  type Node,
  type PathShape,
  type RadialGradient,
  type PolygonShape,
  type RectShape,
  type TextMeta,
} from "../doc/document";
import {
  extendCanvas,
  linkedSize,
  round2,
  scaleDetails,
  scaledSide,
  scaleDrawing,
  scaleRefusal,
  sizeRefusal,
} from "../doc/doc-resize";
import { applyMat, IDENTITY, multiply, rotate, translate } from "../geom/mat";
import { parseSvg } from "../svg/parse";
import { serializeDoc } from "../svg/serialize";
import { deepFreeze } from "./helpers";

const rect = (over: Partial<RectShape> = {}): RectShape => ({
  kind: "rect",
  id: "r",
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  x: 10,
  y: 20,
  w: 30,
  h: 40,
  rx: 0,
  ...over,
});

/** A 100×50 document whose first layer holds `nodes`; a second, locked and hidden layer holds `back`. */
const docWith = (nodes: Node[], back: Node[] = []): Doc => {
  const d = createDoc(100, 50);
  return deepFreeze({
    ...d,
    nextId: 20,
    layers: [
      { ...d.layers[0], children: nodes },
      { id: "L2", name: "Back", visible: false, locked: true, children: back },
    ],
  });
};

describe("extendCanvas", () => {
  it.each([
    [0, 0, 0, 0],
    [0.5, 0, 50, 0],
    [1, 0, 100, 0],
    [0, 0.5, 0, 25],
    [0.5, 0.5, 50, 25],
    [1, 0.5, 100, 25],
    [0, 1, 0, 50],
    [0.5, 1, 50, 50],
    [1, 1, 100, 50],
  ] as const)("anchor (%s, %s) grows 100×50 → 200×100 moving by (%s, %s)", (ax, ay, dx, dy) => {
    const out = extendCanvas(docWith([rect()]), 200, 100, ax, ay);
    expect(out.artboard).toEqual({ w: 200, h: 100, background: { color: "#ffffff", opacity: 1 } });
    expect(out.layers[0].children[0].transform).toEqual([1, 0, 0, 1, dx, dy]);
  });

  it("a shrink moves the other way (right anchor, 100 → 60 wide: −40)", () => {
    const out = extendCanvas(docWith([rect()]), 60, 50, 1, 0.5);
    expect(out.layers[0].children[0].transform).toEqual([1, 0, 0, 1, -40, 0]);
  });

  it("adds to an existing transform's translation only", () => {
    const t: [number, number, number, number, number, number] = [0, 1, -1, 0, 5, 6];
    const out = extendCanvas(docWith([rect({ transform: t })]), 200, 50, 1, 0);
    expect(out.layers[0].children[0].transform).toEqual([0, 1, -1, 0, 105, 6]);
  });

  it("moves hidden and locked content, and leaves nested transforms alone", () => {
    const child = rect({ id: "c", transform: translate(3, 4), hidden: true });
    const group: Group = {
      kind: "group",
      id: "g",
      transform: IDENTITY,
      opacity: 1,
      children: [child],
    };
    const out = extendCanvas(docWith([group], [rect({ id: "b", locked: true })]), 200, 50, 1, 0);
    const g = out.layers[0].children[0] as Group;
    expect(g.transform).toEqual([1, 0, 0, 1, 100, 0]);
    expect(g.children[0]).toBe(child);
    expect(out.layers[1].children[0].transform).toEqual([1, 0, 0, 1, 100, 0]);
  });

  it("keeps the shape itself (geometry, style) untouched — nothing is baked", () => {
    const r = rect({ rx: 4 });
    const out = extendCanvas(docWith([r]), 200, 50, 1, 0);
    expect({ ...out.layers[0].children[0], transform: IDENTITY }).toEqual(r);
  });

  it("returns the same document when nothing changes", () => {
    const d = docWith([rect()]);
    expect(extendCanvas(d, 100, 50, 1, 1)).toBe(d);
  });

  it("with the top-left anchor only the artboard changes; nodes keep their references", () => {
    const d = docWith([rect()]);
    const out = extendCanvas(d, 300, 300, 0, 0);
    expect(out.layers[0].children[0]).toBe(d.layers[0].children[0]);
    expect(out.artboard.w).toBe(300);
  });

  it("throws on an invalid size", () => {
    expect(() => extendCanvas(docWith([]), 0, 50, 0, 0)).toThrow(RangeError);
  });
});

describe("sizeRefusal", () => {
  it("accepts valid sides", () => expect(sizeRefusal(100, 0.5)).toBeNull());
  it("refuses an empty or non-numeric side", () => {
    expect(sizeRefusal(null, 50)).toBe("Enter a width and a height");
    expect(sizeRefusal(100, undefined)).toBe("Enter a width and a height");
  });
  it("refuses a side over the maximum", () =>
    expect(sizeRefusal(100001, 50)).toBe("Too large — at most 100000 px a side"));
  it("refuses a zero or negative side", () =>
    expect(sizeRefusal(0, 50)).toBe("Too small — a side must be more than 0 px"));
});

describe("ratio helpers", () => {
  it("linkedSize keeps the ratio in whole pixels, at least 1", () => {
    expect(linkedSize(200, 100, 50)).toBe(100);
    expect(linkedSize(101, 100, 50)).toBe(51); // 50.5 rounds up
    expect(linkedSize(1, 1000, 1)).toBe(1);
  });
  it("scaledSide keeps the ratio to 2 decimals", () => {
    expect(scaledSide(1000, 1920, 1080)).toBe(562.5);
    expect(scaledSide(100, 3, 1)).toBe(33.33);
  });
  it("round2", () => expect(round2(2 / 3)).toBe(0.67));
});

const first = (d: Doc) => d.layers[0].children[0];

const meta: TextMeta = {
  text: "Hi",
  font: "anton",
  size: 40,
  letterSpacing: 2,
  lineHeight: 1.2,
  align: "left",
  seed: 7,
  amounts: { rotate: 0, scale: 0, offset: 3, skew: 0 },
  overrides: {},
};
const title = (): PathShape => ({
  kind: "path",
  id: "t",
  transform: translate(5, 5),
  style: DEFAULT_STYLE,
  text: meta,
  subpaths: [
    {
      closed: true,
      nodes: [
        { p: { x: 0, y: 0 }, in: null, out: null, type: "corner" },
        { p: { x: 20, y: 0 }, in: null, out: null, type: "corner" },
        { p: { x: 20, y: 30 }, in: null, out: null, type: "corner" },
      ],
    },
  ],
});
const polygon = (): PolygonShape => ({
  kind: "polygon",
  id: "p",
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  cx: 50,
  cy: 25,
  rx: 10,
  ry: 10,
  sides: 5,
  star: false,
  innerRatio: 0.5,
});

describe("scaleDetails", () => {
  it("multiplies a stroked shape's width and a rect's radius", () => {
    const r = scaleDetails(rect({ rx: 4, style: { ...DEFAULT_STYLE, strokeWidth: 3 } }), 2);
    expect(r.style.strokeWidth).toBe(6);
    expect((r as RectShape).rx).toBe(8);
  });
  it("leaves an unstroked width alone", () => {
    const s = { ...DEFAULT_STYLE, stroke: null, strokeWidth: 3 };
    expect(scaleDetails(rect({ style: s }), 2).style).toBe(s);
  });
  it("returns the same shape when nothing applies", () => {
    const e: EllipseShape = {
      kind: "ellipse",
      id: "e",
      transform: IDENTITY,
      style: { ...DEFAULT_STYLE, stroke: null },
      cx: 0,
      cy: 0,
      rx: 1,
      ry: 1,
    };
    expect(scaleDetails(e, 2)).toBe(e);
  });
});

describe("scaleDrawing", () => {
  it("scales a rectangle about the origin, with its stroke and radius", () => {
    const out = scaleDrawing(docWith([rect({ rx: 4 })]), 2);
    expect(first(out)).toMatchObject({ kind: "rect", x: 20, y: 40, w: 60, h: 80, rx: 8 });
    expect((first(out) as RectShape).style.strokeWidth).toBe(2);
    expect(out.artboard).toMatchObject({ w: 200, h: 100 });
  });

  it("scales a rounded rectangle DOWN without clamping the radius twice", () => {
    const out = scaleDrawing(docWith([rect({ w: 10, h: 10, rx: 5 })]), 0.5);
    expect(first(out)).toMatchObject({ w: 5, h: 5, rx: 2.5 });
  });

  it("keeps a rotated rectangle a rectangle", () => {
    const out = scaleDrawing(docWith([rect({ transform: rotate(0.3) })]), 3);
    expect(first(out).kind).toBe("rect");
  });

  it("keeps a polygon live", () => {
    const out = scaleDrawing(docWith([polygon()]), 2);
    expect(first(out)).toMatchObject({ kind: "polygon", cx: 100, cy: 50, rx: 20, ry: 20 });
  });

  it("keeps a title's text, its size scaled", () => {
    const t = first(scaleDrawing(docWith([title()]), 2)) as PathShape;
    expect(t.text?.size).toBe(80);
    expect(t.text?.letterSpacing).toBe(4);
    expect(t.text?.amounts.offset).toBe(6);
    expect(t.style.strokeWidth).toBe(2);
  });

  it("maps a linear gradient's points by k", () => {
    const g = {
      kind: "linear" as const,
      from: { x: 10, y: 20 },
      to: { x: 40, y: 20 },
      start: { color: "#ff0000", opacity: 1 },
      end: { color: "#0000ff", opacity: 1 },
    };
    const out = first(scaleDrawing(docWith([rect({ style: { ...DEFAULT_STYLE, fill: g } })]), 2));
    expect((out as RectShape).style.fill).toMatchObject({
      from: { x: 20, y: 40 },
      to: { x: 80, y: 40 },
    });
  });

  it("scales hidden and locked content and a group's children", () => {
    const child = rect({ id: "c", hidden: true });
    const group: Group = {
      kind: "group",
      id: "g",
      transform: IDENTITY,
      opacity: 1,
      children: [child],
    };
    const out = scaleDrawing(docWith([group], [rect({ id: "b", locked: true })]), 2);
    expect((first(out) as Group).children[0]).toMatchObject({ x: 20, w: 60, hidden: true });
    expect(out.layers[1].children[0]).toMatchObject({ x: 20, w: 60, locked: true });
  });

  it("rounds the artboard to 2 decimals", () => {
    expect(scaleDrawing(docWith([]), 1 / 3).artboard).toMatchObject({ w: 33.33, h: 16.67 });
  });

  it("returns the same document for k = 1", () => {
    const d = docWith([rect()]);
    expect(scaleDrawing(d, 1)).toBe(d);
  });

  it("throws when refused", () => {
    expect(() => scaleDrawing(docWith([]), 0)).toThrow(RangeError);
  });

  it("round-trips: a scaled title and polygon come back from a save as a title and a polygon", () => {
    const out = scaleDrawing(docWith([title(), polygon()]), 2);
    const back = parseSvg(serializeDoc(out)).doc.layers[0].children;
    expect((back[0] as PathShape).text?.size).toBe(80);
    expect(back[1].kind).toBe("polygon");
  });
});

describe("scaleDrawing — more kinds (spec §5)", () => {
  it("scales an ellipse's centre and radii", () => {
    const e: EllipseShape = {
      kind: "ellipse",
      id: "e",
      transform: IDENTITY,
      style: DEFAULT_STYLE,
      cx: 10,
      cy: 20,
      rx: 5,
      ry: 7,
    };
    expect(first(scaleDrawing(docWith([e]), 3))).toMatchObject({ cx: 30, cy: 60, rx: 15, ry: 21 });
  });

  it("leaves the width of an unstroked shape alone", () => {
    const style = { ...DEFAULT_STYLE, stroke: null, strokeWidth: 3 };
    const out = first(scaleDrawing(docWith([rect({ style })]), 2)) as RectShape;
    expect(out.style.strokeWidth).toBe(3);
  });

  it("a radial gradient on a rect in a rotated group keeps its world centre scaling by k", () => {
    const radial: RadialGradient = {
      kind: "radial",
      center: { x: 25, y: 40 },
      a: { x: 45, y: 40 },
      b: { x: 25, y: 60 },
      start: { color: "#ff0000", opacity: 1 },
      end: { color: "#0000ff", opacity: 1 },
    };
    const r = rect({ style: { ...DEFAULT_STYLE, fill: radial }, transform: translate(7, 3) });
    const gT = multiply(translate(30, 10), rotate(0.4));
    const group: Group = { kind: "group", id: "g", transform: gT, opacity: 1, children: [r] };
    const world = (d: Doc) => {
      const g = first(d) as Group;
      const rr = g.children[0] as RectShape;
      return applyMat(
        multiply(g.transform, rr.transform),
        (rr.style.fill as RadialGradient).center,
      );
    };
    const k = 2.5;
    const before = world(docWith([group]));
    const out = scaleDrawing(docWith([group]), k);
    const after = world(out);
    expect((first(out) as Group).transform).toEqual(gT);
    expect((first(out) as Group).children[0].kind).toBe("rect");
    expect(after.x).toBeCloseTo(before.x * k, 6);
    expect(after.y).toBeCloseTo(before.y * k, 6);
  });
});

describe("extendCanvas keeps live shapes live", () => {
  it("a polygon and a title's text survive, apart from the transform", () => {
    const p = polygon();
    const t = title();
    const out = extendCanvas(docWith([p, t]), 200, 100, 1, 1);
    const [op, ot] = out.layers[0].children;
    expect(op).toEqual({ ...p, transform: [1, 0, 0, 1, 100, 50] });
    expect(op.kind).toBe("polygon");
    expect((ot as PathShape).text).toBe(meta);
    expect(ot).toEqual({ ...t, transform: [1, 0, 0, 1, 105, 55] });
  });
});

describe("scaleRefusal", () => {
  it("accepts an ordinary scale", () => expect(scaleRefusal(docWith([rect()]), 2)).toBeNull());
  it("refuses a non-positive or non-finite k", () => {
    expect(scaleRefusal(docWith([]), 0)).toBe("Too small — a side must be more than 0 px");
    expect(scaleRefusal(docWith([]), -1)).toBe("Too small — a side must be more than 0 px");
    expect(scaleRefusal(docWith([]), Number.NaN)).toBe("Enter a width and a height");
  });
  it("refuses a page over the maximum", () =>
    expect(scaleRefusal(docWith([]), 1001)).toBe("Too large — at most 100000 px a side"));
  it("refuses a page that rounds to nothing", () =>
    expect(scaleRefusal(docWith([]), 0.00001)).toBe("Too small — a side must be more than 0 px"));
  it("refuses coordinates past MAX_COORD, hidden content included", () => {
    const far = rect({ id: "far", x: 2e8, hidden: true });
    const group: Group = {
      kind: "group",
      id: "g",
      transform: IDENTITY,
      opacity: 1,
      children: [far],
    };
    expect(scaleRefusal(docWith([group]), 10)).toBe(
      "Scaling by 10× would put the drawing out of range",
    );
  });
});
