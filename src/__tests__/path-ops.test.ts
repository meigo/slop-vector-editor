import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  idFor,
  type Doc,
  type Group,
  type PathShape,
  type Subpath,
} from "../doc/document";
import {
  breakApart,
  combine,
  pathOpRefusal,
  reverseSelection,
  subdivideSelection,
} from "../doc/path-ops";
import { findNode } from "../doc/tree";

const IDENT: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

const ring = (cx: number, r: number): Subpath => ({
  closed: true,
  nodes: [
    { p: { x: cx - r, y: 0 }, in: null, out: null, type: "corner" },
    { p: { x: cx, y: r }, in: null, out: null, type: "corner" },
    { p: { x: cx + r, y: 0 }, in: null, out: null, type: "corner" },
    { p: { x: cx, y: -r }, in: null, out: null, type: "corner" },
  ],
});

function docWith(shapes: PathShape[]): Doc {
  const base = createDoc(200, 200);
  return {
    ...base,
    nextId: 100,
    layers: [{ ...base.layers[0], children: shapes }],
  };
}

const path = (id: string, subpaths: Subpath[], extra: Partial<PathShape> = {}): PathShape => ({
  kind: "path",
  id,
  transform: IDENT,
  style: DEFAULT_STYLE,
  subpaths,
  ...extra,
});

describe("breakApart", () => {
  it("turns one path of N subpaths into N path nodes", () => {
    const doc = docWith([path("a", [ring(50, 20), ring(50, 10)])]);
    const out = breakApart(doc, ["a"]);
    expect(out.doc.layers[0].children).toHaveLength(2);
    expect(out.ids).toHaveLength(2);
  });

  it("keeps the original's place in the z-order", () => {
    const doc = docWith([
      path("back", [ring(0, 5)]),
      path("multi", [ring(50, 20), ring(50, 10)]),
      path("front", [ring(100, 5)]),
    ]);
    const out = breakApart(doc, ["multi"]);
    const ids = out.doc.layers[0].children.map((n) => n.id);
    expect(ids[0]).toBe("back");
    expect(ids[ids.length - 1]).toBe("front");
    expect(ids).toHaveLength(4);
  });

  it("keeps the original's id for the first fragment and allocates fresh ones after", () => {
    const doc = docWith([path("a", [ring(50, 20), ring(50, 10)])]);
    const out = breakApart(doc, ["a"]);
    expect(out.ids[0]).toBe("a");
    expect(out.ids[1]).toBe(idFor(100));
    expect(out.doc.nextId).toBe(101);
  });

  it("carries style, transform, name, hidden and locked onto every fragment", () => {
    const doc = docWith([
      path("a", [ring(50, 20), ring(50, 10)], {
        name: "Logo",
        hidden: true,
        locked: true,
        transform: [2, 0, 0, 2, 5, 5],
      }),
    ]);
    const out = breakApart(doc, ["a"]);
    for (const id of out.ids) {
      const f = findNode(out.doc, id)!.node as PathShape;
      expect(f.name).toBe("Logo");
      expect(f.hidden).toBe(true);
      expect(f.locked).toBe(true);
      expect(f.transform).toEqual([2, 0, 0, 2, 5, 5]);
    }
  });

  it("drops a title's text, because the outlines no longer spell the string", () => {
    const doc = docWith([path("a", [ring(50, 20), ring(50, 10)], { text: { seed: 1 } as never })]);
    const out = breakApart(doc, ["a"]);
    for (const id of out.ids) {
      expect((findNode(out.doc, id)!.node as PathShape).text).toBeUndefined();
    }
  });

  it("returns the same document reference when nothing has more than one subpath", () => {
    const doc = docWith([path("a", [ring(50, 20)])]);
    expect(breakApart(doc, ["a"]).doc).toBe(doc);
  });

  it("breaks two multi-subpath paths in one call, allocating fresh ids across both without collision", () => {
    const doc = docWith([
      path("a", [ring(50, 20), ring(50, 10)]),
      path("b", [ring(150, 20), ring(150, 10), ring(150, 5)]),
    ]);
    const out = breakApart(doc, ["a", "b"]);
    expect(out.ids).toEqual(["a", idFor(100), "b", idFor(101), idFor(102)]);
    expect(new Set(out.ids).size).toBe(out.ids.length);
    expect(out.doc.nextId).toBe(103);
    expect(out.doc.layers[0].children.map((n) => n.id)).toEqual(out.ids);
  });
});

describe("combine", () => {
  it("gathers every operand's subpaths into one node", () => {
    const doc = docWith([path("a", [ring(50, 20)]), path("b", [ring(50, 10)])]);
    const out = combine(doc, ["a", "b"])!;
    expect(out.doc.layers[0].children).toHaveLength(1);
    const p = findNode(out.doc, out.id)!.node as PathShape;
    expect(p.subpaths).toHaveLength(2);
  });

  it("builds the result in the frontmost operand's place, with its style and name", () => {
    const doc = docWith([
      path("back", [ring(50, 20)], { name: "Back" }),
      path("front", [ring(50, 10)], { name: "Front" }),
    ]);
    const out = combine(doc, ["back", "front"])!;
    expect(out.id).toBe("front");
    expect((findNode(out.doc, out.id)!.node as PathShape).name).toBe("Front");
  });

  it("maps an operand from another parent space so it draws where it drew", () => {
    const moved = path("b", [ring(0, 10)], { transform: [1, 0, 0, 1, 50, 0] });
    const doc = docWith([path("a", [ring(50, 20)]), moved]);
    const out = combine(doc, ["a", "b"])!;
    const p = findNode(out.doc, out.id)!.node as PathShape;
    // `b`'s first node was at (-10, 0) under a +50 x translation, i.e. (40, 0) on screen. The
    // result sits in `b`'s own (identity) parent space, so the coordinate is unchanged.
    const xs = p.subpaths[1].nodes.map((n) => n.p.x);
    expect(xs).toContain(40);
  });

  it("deletes every operand but the frontmost", () => {
    const doc = docWith([path("a", [ring(50, 20)]), path("b", [ring(50, 10)])]);
    const out = combine(doc, ["a", "b"])!;
    expect(findNode(out.doc, "a")).toBeNull();
  });

  it("converts a rect, as the booleans do, so two circles can make a donut", () => {
    const base = createDoc(200, 200);
    const doc: Doc = {
      ...base,
      layers: [
        {
          ...base.layers[0],
          children: [
            {
              kind: "rect",
              id: "r",
              transform: IDENT,
              style: DEFAULT_STYLE,
              x: 0,
              y: 0,
              w: 10,
              h: 10,
              rx: 0,
            },
            path("p", [ring(50, 10)]),
          ],
        },
      ],
    };
    const out = combine(doc, ["r", "p"])!;
    const p = findNode(out.doc, out.id)!.node as PathShape;
    expect(p.kind).toBe("path");
    expect(p.subpaths).toHaveLength(2);
  });

  it("returns null for fewer than two shapes", () => {
    const doc = docWith([path("a", [ring(50, 20)])]);
    expect(combine(doc, ["a"])).toBeNull();
  });

  it("treats one id named twice as one shape", () => {
    const doc = docWith([path("a", [ring(50, 20)])]);
    expect(combine(doc, ["a", "a"])).toBeNull();
  });

  it("drops the result's text", () => {
    const doc = docWith([
      path("a", [ring(50, 20)], { text: { seed: 1 } as never }),
      path("b", [ring(50, 10)]),
    ]);
    const out = combine(doc, ["a", "b"])!;
    expect((findNode(out.doc, out.id)!.node as PathShape).text).toBeUndefined();
  });

  it("maps an outside operand into the frontmost operand's group, which sits under a translate", () => {
    const base = createDoc(200, 200);
    const doc: Doc = {
      ...base,
      layers: [
        {
          ...base.layers[0],
          children: [
            // Outside the group, so it must be re-expressed in the group's space.
            path("outside", [ring(150, 20)]),
            {
              kind: "group",
              id: "g",
              transform: [1, 0, 0, 1, 100, 0],
              opacity: 1,
              children: [path("inside", [ring(0, 10)])],
            },
          ],
        },
      ],
    };
    // "inside" is nested in the group placed AFTER "outside" in the layer, so it is the
    // frontmost operand: the result must replace it in place, inside the group.
    const out = combine(doc, ["outside", "inside"])!;
    const g = out.doc.layers[0].children.find((n) => n.id === "g") as Group;
    expect(g.children).toHaveLength(1);
    expect(g.children[0].id).toBe("inside");

    // "outside"'s leftmost point is at world x = 150 - 20 = 130. The group's own transform adds
    // +100, so to draw at the same world position from inside the group, the stored coordinate
    // must be 130 - 100 = 30. A `toParent` of IDENTITY (i.e. dropping the group's transform)
    // would instead leave it at 130, so this fails if the parent-space mapping is skipped.
    const p = findNode(out.doc, "inside")!.node as PathShape;
    const xs = p.subpaths.flatMap((sp) => sp.nodes.map((n) => n.p.x));
    expect(xs).toContain(30);
  });
});

describe("reverse then combine: the donut", () => {
  it("leaves two rings winding the same way when they are merely combined", () => {
    const doc = docWith([path("outer", [ring(50, 20)]), path("inner", [ring(50, 10)])]);
    const out = combine(doc, ["outer", "inner"])!;
    const p = findNode(out.doc, out.id)!.node as PathShape;
    expect(Math.sign(area(p.subpaths[0]))).toBe(Math.sign(area(p.subpaths[1])));
  });

  it("winds the inner subpath against the outer when the inner is reversed FIRST", () => {
    const doc = docWith([path("outer", [ring(50, 20)]), path("inner", [ring(50, 10)])]);
    // Order matters: Reverse direction acts on a whole path, so it must be applied while the
    // inner ring is still its own node. Reversing AFTER the combine flips both subpaths and
    // leaves their relative winding exactly as it was.
    const reversed = reverseSelection(doc, ["inner"]);
    const out = combine(reversed, ["outer", "inner"])!;
    const p = findNode(out.doc, out.id)!.node as PathShape;
    expect(Math.sign(area(p.subpaths[0]))).not.toBe(Math.sign(area(p.subpaths[1])));
  });

  it("reversing the combined path flips both subpaths, so it does not make a hole", () => {
    const doc = docWith([path("outer", [ring(50, 20)]), path("inner", [ring(50, 10)])]);
    const out = combine(doc, ["outer", "inner"])!;
    const after = findNode(reverseSelection(out.doc, [out.id]), out.id)!.node as PathShape;
    expect(Math.sign(area(after.subpaths[0]))).toBe(Math.sign(area(after.subpaths[1])));
  });
});

/** Twice the signed area of a subpath's anchor polygon — the shoelace formula. Its sign is the
 *  winding direction, which is the only thing these tests read from it. */
function area(sp: Subpath): number {
  let a = 0;
  for (let i = 0; i < sp.nodes.length; i++) {
    const p = sp.nodes[i].p;
    const q = sp.nodes[(i + 1) % sp.nodes.length].p;
    a += p.x * q.y - q.x * p.y;
  }
  return a;
}

describe("subdivideSelection", () => {
  it("subdivides every selected path", () => {
    const doc = docWith([path("a", [ring(50, 20)]), path("b", [ring(50, 10)])]);
    const out = subdivideSelection(doc, ["a", "b"]);
    expect((findNode(out, "a")!.node as PathShape).subpaths[0].nodes).toHaveLength(8);
    expect((findNode(out, "b")!.node as PathShape).subpaths[0].nodes).toHaveLength(8);
  });

  it("leaves a non-path node alone and returns the same reference", () => {
    const base = createDoc(200, 200);
    const doc: Doc = {
      ...base,
      layers: [
        {
          ...base.layers[0],
          children: [
            {
              kind: "rect",
              id: "r",
              transform: IDENT,
              style: DEFAULT_STYLE,
              x: 0,
              y: 0,
              w: 10,
              h: 10,
              rx: 0,
            },
          ],
        },
      ],
    };
    expect(subdivideSelection(doc, ["r"])).toBe(doc);
  });
});

describe("pathOpRefusal", () => {
  it("refuses Combine with fewer than two shapes", () => {
    const doc = docWith([path("a", [ring(50, 20)])]);
    expect(pathOpRefusal(doc, ["a"], "combine")).toBe("select two or more shapes");
  });

  it("refuses Combine on a group", () => {
    const base = createDoc(200, 200);
    const group: Group = {
      kind: "group",
      id: "g",
      transform: IDENT,
      opacity: 1,
      children: [path("c1", [ring(0, 5)])],
    };
    const doc: Doc = {
      ...base,
      layers: [{ ...base.layers[0], children: [group, path("a", [ring(50, 20)])] }],
    };
    expect(pathOpRefusal(doc, ["g", "a"], "combine")).toBe("a group can't take part");
  });

  it("refuses Break apart when nothing has more than one subpath", () => {
    const doc = docWith([path("a", [ring(50, 20)])]);
    expect(pathOpRefusal(doc, ["a"], "breakApart")).toBe(
      "select a path with more than one subpath",
    );
  });

  it("refuses Subdivide, Reverse and Simplify when no path is selected", () => {
    const doc = docWith([]);
    for (const op of ["subdivide", "reverse", "simplify"] as const) {
      expect(pathOpRefusal(doc, [], op)).toBe("select a path");
    }
  });

  it("allows each operation when its precondition is met", () => {
    const doc = docWith([path("a", [ring(50, 20), ring(50, 10)]), path("b", [ring(50, 5)])]);
    expect(pathOpRefusal(doc, ["a"], "subdivide")).toBeNull();
    expect(pathOpRefusal(doc, ["a"], "reverse")).toBeNull();
    expect(pathOpRefusal(doc, ["a"], "breakApart")).toBeNull();
    expect(pathOpRefusal(doc, ["a", "b"], "combine")).toBeNull();
    expect(pathOpRefusal(doc, ["a"], "simplify")).toBeNull();
  });

  it("tells someone with a live shape selected to convert it, not that they selected nothing", () => {
    // Refusing an ellipse/rect/polygon for subdivide/reverse/breakApart/simplify is correct (spec
    // M11 §5) — converting it silently would destroy its liveness without being asked. But
    // "select a path" reads as "you selected nothing" when a shape plainly IS selected, so the
    // shape case gets its own reason (invariant 24).
    const base = createDoc(200, 200);
    const ellipse = {
      kind: "ellipse" as const,
      id: "e",
      transform: IDENT,
      style: DEFAULT_STYLE,
      cx: 50,
      cy: 50,
      rx: 20,
      ry: 20,
    };
    const doc: Doc = { ...base, layers: [{ ...base.layers[0], children: [ellipse] }] };
    const convert = "convert the shape to a path first (Object ▸ Convert to path)";
    for (const op of ["subdivide", "reverse", "breakApart", "simplify"] as const) {
      expect(pathOpRefusal(doc, ["e"], op)).toBe(convert);
    }
  });

  it("keeps the plainer reason for a selection with nothing usable in it", () => {
    const doc = docWith([]);
    for (const op of ["subdivide", "reverse", "breakApart", "simplify"] as const) {
      expect(pathOpRefusal(doc, [], op)).toBe("select a path");
    }
  });
});
