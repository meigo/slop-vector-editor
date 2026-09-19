import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE, type Doc, type PathShape, type TextMeta } from "../doc/document";
import { createDoc } from "../doc/document";
import { flattenTransform } from "../doc/edits";
import { movePathNodes, setNodeType } from "../doc/path-edit";
import { resizeNodes } from "../doc/resize";
import { IDENTITY } from "../geom/mat";
import { parseSvg } from "../svg/parse";
import { serializeDoc } from "../svg/serialize";

const meta: TextMeta = {
  text: 'SL"O&P',
  font: "anton",
  size: 96,
  letterSpacing: 2.5,
  lineHeight: 1.2,
  align: "center",
  seed: 418,
  amounts: { rotate: 12, scale: 0.08, offset: 4, skew: 0 },
  overrides: { 3: { r: -12, s: 1.2 } },
};

const title = (over: Partial<PathShape> = {}): PathShape => ({
  kind: "path",
  id: "t1",
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  subpaths: [
    {
      closed: true,
      nodes: [
        { p: { x: 0, y: 0 }, in: null, out: null, type: "corner" },
        { p: { x: 50, y: 0 }, in: null, out: null, type: "corner" },
        { p: { x: 50, y: 40 }, in: null, out: null, type: "corner" },
      ],
    },
  ],
  text: meta,
  ...over,
});

const docWith = (p: PathShape): Doc => {
  const d = createDoc(400, 200);
  return { ...d, nextId: 9, layers: [{ ...d.layers[0], children: [p] }] };
};

const reload = (d: Doc) => parseSvg(serializeDoc(d)).doc.layers[0].children[0] as PathShape;

describe("a title round-trips as a path", () => {
  it("keeps every field, including a string with quotes and ampersands", () => {
    const back = reload(docWith(title()));
    expect(back.kind).toBe("path");
    expect(back.text).toEqual(meta);
  });

  it("survives a full 32-bit seed", () => {
    // Regression, found in the M10b dry run: `newSeed()` returns up to 2^32, and the coordinate
    // ceiling added in the M10a review rejected it — so a re-rolled title silently came back as an
    // ordinary path on the next reload, losing its text for good.
    const big = title({ text: { ...meta, seed: 4294967295 } });
    expect(reload(docWith(big)).text?.seed).toBe(4294967295);
  });

  it("writes no text attributes for an ordinary path", () => {
    const svg = serializeDoc(docWith(title({ text: undefined })));
    expect(svg).not.toContain("data-sv-text");
    expect(reload(docWith(title({ text: undefined }))).text).toBeUndefined();
  });

  it("keeps the artwork when the options are malformed, losing only editability", () => {
    const svg = serializeDoc(docWith(title())).replace(
      /data-sv-text-opts="[^"]*"/,
      'data-sv-text-opts="nonsense"',
    );
    const back = parseSvg(svg).doc.layers[0].children[0] as PathShape;
    expect(back.text).toBeUndefined();
    expect(back.subpaths[0].nodes).toHaveLength(3);
  });

  it("drops overrides that point past the string", () => {
    const svg = serializeDoc(docWith(title())).replace(
      /data-sv-text-chars="[^"]*"/,
      'data-sv-text-chars="99:r=5"',
    );
    const back = parseSvg(svg).doc.layers[0].children[0] as PathShape;
    expect(back.text?.overrides).toEqual({});
  });

  it("stops being a title the moment its nodes are edited", () => {
    const p = title();
    const moved = movePathNodes(p, [{ sub: 0, i: 0 }], 5, 5);
    expect(moved.text).toBeUndefined();
    expect(moved.subpaths[0].nodes[0].p).toEqual({ x: 5, y: 5 });

    const retyped = setNodeType(p, [{ sub: 0, i: 0 }], "smooth");
    expect(retyped.text).toBeUndefined();
  });

  it("survives a uniform resize with its outlines and its size in step", () => {
    // Found in review: resize spread `...s`, keeping `text` while scaling the outlines, so the
    // next keystroke re-outlined at the OLD size and the resize vanished. M10e §7 keeps the title
    // through a uniform scale by scaling the metadata too — so the guard is no longer "text is
    // dropped" but "the outlines and the size agree", which is what the bug actually broke.
    const d = docWith(title());
    const id = d.layers[0].children[0].id;
    const before = (d.layers[0].children[0] as PathShape).text!.size;
    const resized = resizeNodes(d, [id], [2, 0, 0, 2, 0, 0]);
    const p = resized.layers[0].children[0] as PathShape;
    expect(p.subpaths[0].nodes[1].p.x).toBe(100);
    expect(p.text).toBeDefined();
    expect(p.text!.size).toBe(before * 2);
  });

  it("stops being a title when a NON-uniform resize is baked into it", () => {
    // A stretch cannot be expressed as a text size, so the title becomes an ordinary path rather
    // than one that would snap back to its old proportions on the next keystroke.
    const d = docWith(title());
    const id = d.layers[0].children[0].id;
    const p = resizeNodes(d, [id], [2, 0, 0, 3, 0, 0]).layers[0].children[0] as PathShape;
    expect(p.text).toBeUndefined();
    expect(p.subpaths[0].nodes[1].p.x).toBe(100);
  });

  it("stops being a title when its transform is flattened", () => {
    // Found in review: flatten baked the matrix and reset it, so a re-typed title was re-outlined
    // at the baseline origin and jumped off the artboard.
    const moved = title({ transform: [1, 0, 0, 1, 200, 300] });
    const flat = flattenTransform(docWith(moved), [moved.id]).layers[0].children[0] as PathShape;
    expect(flat.text).toBeUndefined();
    expect(flat.subpaths[0].nodes[0].p).toEqual({ x: 200, y: 300 });
  });

  it("stays a title when an edit changes nothing", () => {
    const p = title();
    expect(movePathNodes(p, [], 0, 0)).toBe(p);
  });
});
