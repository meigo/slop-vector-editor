import { describe, expect, it } from "vitest";
import { booleanShapes } from "../doc/boolean-edit";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type Node,
  type PathShape,
  type Style,
} from "../doc/document";
import { flattenTransform, flattenSkips } from "../doc/edits";
import { combine } from "../doc/path-ops";
import { findNode } from "../doc/tree";
import { IDENTITY, multiply, rotate, scale, type Mat } from "../geom/mat";
import { rectPath } from "../geom/shapes";

/** Review M17 (2026-09-30): a bake that folds a node's matrix into its geometry kept the stroke
 *  width, so a `scale(2)` path's stroke visibly halved. */
const stroked = { ...DEFAULT_STYLE, stroke: { color: "#000000", opacity: 1 }, strokeWidth: 1 };
const square = (id: string, t: Mat, style: Style = stroked): PathShape => ({
  kind: "path",
  id,
  transform: t,
  style,
  subpaths: [rectPath(0, 0, 10, 10, 0, 0)],
});
const doc = (children: Node[]): Doc => {
  const d = createDoc(200, 200);
  return { ...d, layers: [{ ...d.layers[0], id: "L0", children }] };
};
const widthOf = (d: Doc, id: string) => (findNode(d, id)?.node as PathShape).style.strokeWidth;

describe("baking a matrix keeps the stroke's look", () => {
  it("Flatten scales the stroke by a uniform scale, rotation or mirror included", () => {
    const d = flattenTransform(doc([square("a", multiply(rotate(0.3), scale(2)))]), ["a"]);
    expect(widthOf(d, "a")).toBeCloseTo(2, 12);
    const m = flattenTransform(doc([square("b", scale(-3, 3))]), ["b"]);
    expect(widthOf(m, "b")).toBeCloseTo(3, 12);
  });

  it("Flatten leaves a stretched stroked path alone, and counts it; an unstroked one bakes", () => {
    const src = doc([
      square("a", scale(2, 1)),
      square("b", scale(2, 1), { ...DEFAULT_STYLE, stroke: null }),
    ]);
    expect(flattenSkips(src, ["a", "b"])).toBe(1);
    const d = flattenTransform(src, ["a", "b"]);
    expect(findNode(d, "a")?.node).toBe(src.layers[0].children[0]);
    expect(findNode(d, "b")?.node.transform).toEqual(IDENTITY);
  });

  it("Combine scales the result's stroke by the frontmost's scale", () => {
    const r = combine(doc([square("a", IDENTITY), square("b", scale(2))]), ["a", "b"]);
    expect(widthOf(r!.doc, r!.id)).toBeCloseTo(2, 12);
  });

  it("a boolean scales the surviving style's stroke the same way", async () => {
    const r = await booleanShapes(
      doc([square("a", IDENTITY), square("b", scale(2))]),
      ["a", "b"],
      "unite",
    );
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(widthOf(r.doc, r.id)).toBeCloseTo(2, 12);
  });
});

describe("Flatten transform in the store", () => {
  it("says how many stretched stroked shapes it left alone", async () => {
    const { app, flattenSelection, replaceDocument, setSelection } =
      await import("../state/appState.svelte");
    replaceDocument(
      doc([square("a", scale(2, 1)), square("b", scale(2))]),
      "Untitled.svg",
      null,
      true,
    );
    app.notices = [];
    setSelection(["a", "b"]);
    flattenSelection();
    expect(findNode(app.doc, "a")?.node.transform).toEqual(scale(2, 1));
    expect(findNode(app.doc, "b")?.node.transform).toEqual(IDENTITY);
    expect(app.notices.map((n) => n.text)).toEqual([
      "Flatten transform left a stroked shape as it was: a stretched or skewed stroke can't be baked into one width.",
    ]);
  });
});
