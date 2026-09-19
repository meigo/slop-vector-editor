import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type Node,
  type Paint,
  type Style,
} from "../doc/document";
import { IDENTITY } from "../geom/mat";
import { allIds, invertIds, sameIds } from "../doc/select-match";

const paint = (color: string, opacity = 1): Paint => ({ color, opacity });
const style = (patch: Partial<Style> = {}): Style => ({ ...DEFAULT_STYLE, ...patch });

const rect = (id: string, s: Style): Node => ({
  kind: "rect",
  id,
  transform: IDENTITY,
  style: s,
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  rx: 0,
});

const ellipse = (id: string, s: Style): Node => ({
  kind: "ellipse",
  id,
  transform: IDENTITY,
  style: s,
  cx: 0,
  cy: 0,
  rx: 5,
  ry: 5,
});

const group = (id: string, children: Node[]): Node => ({
  kind: "group",
  id,
  transform: IDENTITY,
  opacity: 1,
  children,
});

const ORANGE = style({ fill: paint("#ff8800"), stroke: paint("#000000") });
const BLUE = style({ fill: paint("#0088ff"), stroke: paint("#000000") });
const ORANGE_THICK = style({ fill: paint("#ff8800"), stroke: paint("#000000"), strokeWidth: 4 });
const NO_FILL = style({ fill: null, stroke: paint("#000000") });

/** L0 visible: orange rect a, blue rect b, orange ellipse c, no-fill rect d, group g(e orange).
 *  L1 hidden: orange rect h. L2 locked: orange rect k. */
function makeDoc(): Doc {
  const base = createDoc(200, 200);
  return {
    ...base,
    layers: [
      {
        id: "L0",
        name: "L0",
        visible: true,
        locked: false,
        children: [
          rect("a", ORANGE),
          rect("b", BLUE),
          ellipse("c", ORANGE),
          rect("d", NO_FILL),
          group("g", [rect("e", ORANGE)]),
        ],
      },
      { id: "L1", name: "L1", visible: false, locked: false, children: [rect("h", ORANGE)] },
      { id: "L2", name: "L2", visible: true, locked: true, children: [rect("k", ORANGE)] },
    ],
  };
}

describe("allIds", () => {
  it("returns every top-level id on a visible, unlocked layer, in document order", () => {
    expect(allIds(makeDoc(), null)).toEqual(["a", "b", "c", "d", "g"]);
  });

  it("returns an entered group's children instead", () => {
    expect(allIds(makeDoc(), "g")).toEqual(["e"]);
  });
});

describe("invertIds", () => {
  it("returns everything in reach that is not selected", () => {
    expect(invertIds(makeDoc(), ["a", "c"], null)).toEqual(["b", "d", "g"]);
  });

  it("clears a full selection and selects everything from an empty one", () => {
    const doc = makeDoc();
    expect(invertIds(doc, ["a", "b", "c", "d", "g"], null)).toEqual([]);
    expect(invertIds(doc, [], null)).toEqual(["a", "b", "c", "d", "g"]);
  });

  it("ignores a selected id that is out of reach", () => {
    // "h" is on a hidden layer: it is not in reach, so it cannot be subtracted from it.
    expect(invertIds(makeDoc(), ["h"], null)).toEqual(["a", "b", "c", "d", "g"]);
  });
});

describe("sameIds", () => {
  it("matches fill across kinds, and never reaches a hidden or locked layer", () => {
    expect(sameIds(makeDoc(), ["a"], null, "fill")).toEqual(["a", "c"]);
  });

  it("unions several seeds", () => {
    expect(sameIds(makeDoc(), ["a", "b"], null, "fill")).toEqual(["a", "b", "c"]);
  });

  it("matches a null fill only against another null fill", () => {
    expect(sameIds(makeDoc(), ["d"], null, "fill")).toEqual(["d"]);
    expect(sameIds(makeDoc(), ["a"], null, "fill")).not.toContain("d");
  });

  it("matches stroke independently of fill", () => {
    // Every shape on L0 has the same black stroke, so the orange seed finds all of them.
    expect(sameIds(makeDoc(), ["a"], null, "stroke")).toEqual(["a", "b", "c", "d"]);
  });

  it("requires every style field to match", () => {
    const doc = makeDoc();
    const thick: Doc = {
      ...doc,
      layers: [
        { ...doc.layers[0], children: [...doc.layers[0].children, rect("t", ORANGE_THICK)] },
        ...doc.layers.slice(1),
      ],
    };
    expect(sameIds(thick, ["a"], null, "style")).toEqual(["a", "c"]);
    expect(sameIds(thick, ["t"], null, "style")).toEqual(["t"]);
  });

  it("matches kind, including groups", () => {
    expect(sameIds(makeDoc(), ["a"], null, "kind")).toEqual(["a", "b", "d"]);
    expect(sameIds(makeDoc(), ["g"], null, "kind")).toEqual(["g"]);
  });

  it("skips groups for the style fields, as seed and as candidate", () => {
    const doc = makeDoc();
    // A group seed has no style, so a style match finds nothing at all.
    expect(sameIds(doc, ["g"], null, "fill")).toEqual([]);
    // And a group is never returned by one.
    expect(sameIds(doc, ["a"], null, "fill")).not.toContain("g");
  });

  it("stays inside an entered group", () => {
    expect(sameIds(makeDoc(), ["e"], "g", "fill")).toEqual(["e"]);
  });

  it("returns an empty array for an empty selection", () => {
    expect(sameIds(makeDoc(), [], null, "fill")).toEqual([]);
  });
});
