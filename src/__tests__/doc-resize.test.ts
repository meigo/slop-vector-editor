import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type Group,
  type Node,
  type RectShape,
} from "../doc/document";
import { extendCanvas, linkedSize, round2, scaledSide, sizeRefusal } from "../doc/doc-resize";
import { IDENTITY, translate } from "../geom/mat";
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
    const group: Group = { kind: "group", id: "g", transform: IDENTITY, children: [child] };
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
