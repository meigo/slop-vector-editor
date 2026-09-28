import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Group, type Node } from "../doc/document";
import { alignNodes, distributeNodes } from "../doc/align";
import { findNode } from "../doc/tree";
import { nodeBounds } from "../geom/bounds";
import { IDENTITY, multiply, rotate, translate, type Mat } from "../geom/mat";

const rect = (id: string, x: number, y: number, w = 20, h = 10, t: Mat = IDENTITY): Node => ({
  kind: "rect",
  id,
  transform: t,
  style: DEFAULT_STYLE,
  x,
  y,
  w,
  h,
  rx: 0,
});
const doc = (children: Node[]): Doc => {
  const d = createDoc(200, 100);
  return { ...d, layers: [{ ...d.layers[0], id: "L0", children }] };
};
const box = (d: Doc, id: string) => {
  const f = findNode(d, id)!;
  return nodeBounds(f.node, f.parent)!;
};

describe("alignNodes (spec M19 §1)", () => {
  // a: x 10–30, y 0–10; b: x 50–90, y 40–60 → selection bounds x 10–90, y 0–60.
  const two = () => doc([rect("a", 10, 0), rect("b", 50, 40, 40, 20)]);

  it("aligns several objects to the selection's bounds", () => {
    const d = two();
    expect(box(alignNodes(d, ["a", "b"], "left"), "b").x).toBe(10);
    expect(box(alignNodes(d, ["a", "b"], "right"), "a").x).toBe(70);
    expect(box(alignNodes(d, ["a", "b"], "hcenter"), "a").x).toBe(40); // centre 50
    expect(box(alignNodes(d, ["a", "b"], "top"), "b").y).toBe(0);
    expect(box(alignNodes(d, ["a", "b"], "bottom"), "a").y).toBe(50);
    expect(box(alignNodes(d, ["a", "b"], "vcenter"), "a").y).toBe(25); // centre 30
  });

  it("only moves along the chosen axis", () => {
    const out = alignNodes(two(), ["a", "b"], "left");
    expect(box(out, "b").y).toBe(40);
  });

  it("aligns a single object to the artboard", () => {
    const d = doc([rect("a", 10, 20)]);
    expect(box(alignNodes(d, ["a"], "right"), "a").x).toBe(180);
    const c = box(alignNodes(alignNodes(d, ["a"], "hcenter"), ["a"], "vcenter"), "a");
    expect(c.x).toBe(90);
    expect(c.y).toBe(45);
  });

  it("returns the same document when nothing moves", () => {
    const d = doc([rect("a", 0, 0), rect("b", 0, 30)]);
    expect(alignNodes(d, ["a", "b"], "left")).toBe(d);
    expect(alignNodes(d, [], "left")).toBe(d);
  });

  it("keeps the object that already sits on the edge untouched (same reference)", () => {
    const d = two();
    const out = alignNodes(d, ["a", "b"], "left");
    expect(findNode(out, "a")!.node).toBe(findNode(d, "a")!.node);
  });

  it("moves a child of a rotated, translated parent in document space", () => {
    const g: Group = {
      kind: "group",
      id: "g",
      transform: multiply(translate(100, 50), rotate(Math.PI / 2)),
      opacity: 1,
      children: [rect("c", 0, 0), rect("d", 0, 40)],
    };
    const d = doc([g]);
    const out = alignNodes(d, ["c", "d"], "top");
    expect(box(out, "c").y).toBeCloseTo(box(out, "d").y, 9);
    expect(box(out, "c").x).toBeCloseTo(box(d, "c").x, 9);
  });

  it("moves a group as a unit and leaves its children's transforms alone", () => {
    const g: Group = {
      kind: "group",
      id: "g",
      transform: IDENTITY,
      opacity: 1,
      children: [rect("c", 50, 50, 20, 10, translate(1, 1))],
    };
    const out = alignNodes(doc([g]), ["g"], "left");
    expect(findNode(out, "c")!.node.transform).toEqual(translate(1, 1));
    expect(box(out, "c").x).toBe(0);
  });
});

describe("distributeNodes (spec M19 §1)", () => {
  it("equalises the gaps between neighbours, keeping the outermost two", () => {
    // widths 10, 30, 20; span 0–100 → gap (100 − 60) / 2 = 20.
    const d = doc([rect("a", 0, 0, 10), rect("b", 15, 0, 30), rect("c", 80, 0, 20)]);
    const out = distributeNodes(d, ["c", "a", "b"], "h"); // selection order must not matter
    expect(box(out, "a").x).toBe(0);
    expect(box(out, "b").x).toBe(30);
    expect(box(out, "c").x).toBe(80);
  });

  it("distributes vertically", () => {
    const d = doc([rect("a", 0, 0, 10, 10), rect("b", 0, 12, 10, 10), rect("c", 0, 70, 10, 10)]);
    const out = distributeNodes(d, ["a", "b", "c"], "v");
    expect(box(out, "b").y).toBe(35);
  });

  it("allows a negative gap when the objects overlap", () => {
    const d = doc([rect("a", 0, 0, 40), rect("b", 5, 0, 40), rect("c", 20, 0, 40)]);
    const out = distributeNodes(d, ["a", "b", "c"], "h");
    expect(box(out, "b").x).toBe(10); // span 60, widths 120 → gap −30
  });

  it("needs three objects: fewer returns the same document", () => {
    const d = doc([rect("a", 0, 0), rect("b", 50, 0)]);
    expect(distributeNodes(d, ["a", "b"], "h")).toBe(d);
  });

  it("returns the same document when already evenly spaced", () => {
    const d = doc([rect("a", 0, 0, 10), rect("b", 20, 0, 10), rect("c", 40, 0, 10)]);
    expect(distributeNodes(d, ["a", "b", "c"], "h")).toBe(d);
  });
});

describe("alignSelection / distributeSelection (store)", () => {
  it("each command is one undo step", async () => {
    const S = await import("../state/appState.svelte");
    S.replaceDocument(
      doc([rect("a", 0, 0, 10), rect("b", 15, 30, 30), rect("c", 80, 60, 20)]),
      "t.svg",
      null,
      true,
    );
    S.setSelection(["a", "b", "c"]);
    const before = S.app.session.history.past.length;
    S.alignSelection("top");
    S.distributeSelection("h");
    expect(S.app.session.history.past.length).toBe(before + 2);
    expect(box(S.app.doc, "b").x).toBe(30);
    S.undo();
    expect(box(S.app.doc, "b").x).toBe(15);
    expect(box(S.app.doc, "b").y).toBe(0);
  });
});

describe("final-review fixes (M19)", () => {
  it("pressing Align again on rotated objects is a no-op, not float drift", async () => {
    const { alignNodes: align } = await import("../doc/align");
    const g: Group = {
      kind: "group",
      id: "g",
      transform: multiply(translate(37.3, 11.9), rotate(0.7)),
      opacity: 1,
      children: [rect("c", 3.1, 2.2, 17.3, 9.9), rect("d", 41.7, 13.3, 22.1, 7.7, rotate(0.3))],
    };
    const d = doc([g, rect("e", 120.4, 30.6, 11, 13, rotate(1.1))]);
    for (const ids of [
      ["c", "d"],
      ["g", "e"],
    ]) {
      for (const op of ["left", "hcenter", "right", "top", "vcenter", "bottom"] as const) {
        const once = align(d, ids, op);
        expect(align(once, ids, op)).toBe(once);
      }
    }
  });

  it("a group selected with its own child counts once and moves as a unit", async () => {
    const { alignTargetCount } = await import("../doc/align");
    const g: Group = {
      kind: "group",
      id: "g",
      transform: IDENTITY,
      opacity: 1,
      children: [rect("c", 40, 0, 10, 10), rect("k", 0, 0, 100, 10)],
    };
    const d = doc([g, rect("o", 150, 0, 10, 10), rect("p", 190, 0, 10, 10)]);
    expect(alignTargetCount(d, ["g", "c", "o"])).toBe(2);
    // g (0–100), o (150–160), p (190–200): the child c must not be distributed on its own.
    const out = distributeNodes(d, ["g", "c", "o", "p"], "h");
    expect(box(out, "c").x).toBe(40);
    expect(box(out, "o").x).toBe(140); // span 0–200, widths 120 → two gaps of 40
    expect(distributeNodes(d, ["g", "c", "o"], "h")).toBe(d); // only two targets
  });

  it("distribute does not depend on selection order, ties included", () => {
    const d = doc([
      rect("a", 0, 0, 10),
      rect("b", 30, 0, 10),
      rect("c", 30, 0, 20),
      rect("z", 90, 0, 10),
    ]);
    const one = distributeNodes(d, ["a", "b", "c", "z"], "h");
    const two = distributeNodes(d, ["z", "c", "a", "b"], "h");
    expect(box(one, "b").x).toBe(box(two, "b").x);
    expect(box(one, "c").x).toBe(box(two, "c").x);
  });
});
