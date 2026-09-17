import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type Layer,
  type Node,
  type Style,
} from "../doc/document";
import { hitTest, marqueeSelect } from "../geom/hit";
import { IDENTITY, rotateAbout, scale, translate, type Mat } from "../geom/mat";

const filled: Style = { ...DEFAULT_STYLE, stroke: null };
const outlineOnly: Style = { ...DEFAULT_STYLE, fill: null, strokeWidth: 4 };

const rect = (
  id: string,
  x: number,
  y: number,
  style = filled,
  transform: Mat = IDENTITY,
): Node => ({
  kind: "rect",
  id,
  transform,
  style,
  x,
  y,
  w: 10,
  h: 10,
  rx: 0,
});

function doc(...layers: Partial<Layer>[]): Doc {
  const base = createDoc(100, 100);
  return {
    ...base,
    layers: layers.map((l, i) => ({
      id: `L${i}`,
      name: `L${i}`,
      visible: true,
      locked: false,
      children: [],
      ...l,
    })),
  };
}

const at = (x: number, y: number) => ({ x, y });

describe("hitTest", () => {
  it("hits a filled rect inside and misses outside the tolerance", () => {
    const d = doc({ children: [rect("a", 0, 0)] });
    expect(hitTest(d, at(5, 5), 1)).toEqual({ layerId: "L0", nodeId: "a" });
    expect(hitTest(d, at(12, 5), 1)).toBeNull();
    expect(hitTest(d, at(10.5, 5), 1)?.nodeId).toBe("a");
  });

  it("hits an unfilled shape only near its outline, widened by the stroke", () => {
    const d = doc({ children: [rect("a", 0, 0, outlineOnly)] });
    expect(hitTest(d, at(5, 5), 1)).toBeNull();
    expect(hitTest(d, at(2.5, 5), 1)?.nodeId).toBe("a"); // 2.5 from edge ≤ 1 + 4/2
    expect(hitTest(d, at(-2.9, 5), 1)?.nodeId).toBe("a");
    expect(hitTest(d, at(-3.1, 5), 1)).toBeNull();
  });

  it("hits ellipses", () => {
    const e: Node = {
      kind: "ellipse",
      id: "e",
      transform: IDENTITY,
      style: filled,
      cx: 50,
      cy: 50,
      rx: 20,
      ry: 10,
    };
    const d = doc({ children: [e] });
    expect(hitTest(d, at(65, 50), 0)?.nodeId).toBe("e");
    expect(hitTest(d, at(50, 62), 0)).toBeNull();
    expect(hitTest(d, at(50, 61), 1.5)?.nodeId).toBe("e");
    const ring = doc({ children: [{ ...e, style: outlineOnly }] });
    expect(hitTest(ring, at(50, 50), 1)).toBeNull();
    expect(hitTest(ring, at(71, 50), 1)?.nodeId).toBe("e");
  });

  it("measures ellipse outline distance to the nearest point, not along the radius", () => {
    const e: Node = {
      kind: "ellipse",
      id: "e",
      transform: IDENTITY,
      style: { ...DEFAULT_STYLE, fill: null, stroke: null },
      cx: 50,
      cy: 50,
      rx: 20,
      ry: 10,
    };
    const d = doc({ children: [e] });
    // 45° ray crosses the outline at (8.944, 8.944) from the centre; 10% further out is
    // (9.839, 9.839). The true nearest distance there is ≈ 1.091.
    const p = at(50 + 9.839, 50 + 9.839);
    expect(hitTest(d, p, 1.15)?.nodeId).toBe("e");
    expect(hitTest(d, p, 1.0)).toBeNull();
  });

  it("fills paths with nonzero winding, closing open subpaths implicitly", () => {
    const tri: Node = {
      kind: "path",
      id: "t",
      transform: IDENTITY,
      style: filled,
      subpaths: [
        {
          closed: false,
          nodes: [
            { p: at(0, 0), in: null, out: null, type: "corner" },
            { p: at(20, 0), in: null, out: null, type: "corner" },
            { p: at(0, 20), in: null, out: null, type: "corner" },
          ],
        },
      ],
    };
    const d = doc({ children: [tri] });
    expect(hitTest(d, at(4, 4), 0)?.nodeId).toBe("t");
    expect(hitTest(d, at(15, 15), 0)).toBeNull();
  });

  it("respects node transforms and scales the tolerance", () => {
    const rotated = rect("r", 0, 0, filled, rotateAbout(Math.PI / 4, at(5, 5)));
    const d = doc({ children: [rotated] });
    expect(hitTest(d, at(5, -1.5), 0)?.nodeId).toBe("r"); // top corner now points up to y≈-2.07
    expect(hitTest(d, at(0.2, 0.2), 0)).toBeNull(); // old corner is outside now
    const big = doc({ children: [rect("s", 0, 0, outlineOnly, scale(10))] });
    // Stroke 4 local = 40 doc; tolerance 10 doc = 1 local. Edge at x=0; 49 doc away → miss.
    expect(hitTest(big, at(-49, 50), 10)).toBeNull();
    expect(hitTest(big, at(-29, 50), 10)?.nodeId).toBe("s");
  });

  it("returns the top-level group for a hit on a child", () => {
    const g: Node = {
      kind: "group",
      id: "g",
      transform: translate(50, 0),
      opacity: 1,
      children: [rect("inner", 0, 0)],
    };
    const d = doc({ children: [g] });
    expect(hitTest(d, at(55, 5), 0)?.nodeId).toBe("g");
    expect(hitTest(d, at(5, 5), 0)).toBeNull();
  });

  it("prefers the top-most node and skips hidden or locked layers", () => {
    const d = doc(
      { children: [rect("bottom", 0, 0)] },
      { children: [rect("top", 0, 0)] },
      { children: [rect("hidden", 0, 0)], visible: false },
      { children: [rect("locked", 0, 0)], locked: true },
    );
    expect(hitTest(d, at(5, 5), 0)).toEqual({ layerId: "L1", nodeId: "top" });
    const sameLayer = doc({ children: [rect("first", 0, 0), rect("second", 0, 0)] });
    expect(hitTest(sameLayer, at(5, 5), 0)?.nodeId).toBe("second");
  });

  it("never hits a node with a singular matrix", () => {
    const d = doc({ children: [rect("z", 0, 0, filled, [0, 0, 0, 0, 0, 0])] });
    expect(hitTest(d, at(0, 0), 5)).toBeNull();
  });
});

describe("polygon hit-testing", () => {
  const star = (style: Style): Node => ({
    kind: "polygon",
    id: "s",
    transform: IDENTITY,
    style,
    cx: 50,
    cy: 50,
    rx: 20,
    ry: 20,
    sides: 4,
    star: true,
    innerRatio: 0.25,
  });

  it("hits a filled polygon inside, not in the notch between points", () => {
    const d = doc({ children: [star(filled)] });
    expect(hitTest(d, { x: 50, y: 50 }, 1)?.nodeId).toBe("s");
    expect(hitTest(d, { x: 50, y: 35 }, 1)?.nodeId).toBe("s");
    // (62, 38) lies between the top and right points, outside the inner corner at (53.5, 46.5)
    expect(hitTest(d, { x: 62, y: 38 }, 1)).toBeNull();
  });

  it("hits an outline-only polygon near its edge only", () => {
    const d = doc({ children: [star(outlineOnly)] });
    expect(hitTest(d, { x: 50, y: 50 }, 1)).toBeNull();
    expect(hitTest(d, { x: 50, y: 31 }, 1)?.nodeId).toBe("s");
  });
});

describe("marqueeSelect", () => {
  it("selects nodes fully inside, in document order, on selectable layers", () => {
    const d = doc(
      { children: [rect("a", 0, 0), rect("b", 20, 0)] },
      { children: [rect("c", 0, 0)], locked: true },
      { children: [rect("d", 5, 5)] },
    );
    expect(marqueeSelect(d, { x: -1, y: -1, w: 32, h: 12 })).toEqual(["a", "b"]);
    expect(marqueeSelect(d, { x: -1, y: -1, w: 17, h: 17 })).toEqual(["a", "d"]);
    expect(marqueeSelect(d, { x: 1, y: -1, w: 50, h: 50 })).toEqual(["b", "d"]);
  });
});
