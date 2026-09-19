import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE, type Doc, type PathShape, type TextMeta } from "../doc/document";
import { createDoc } from "../doc/document";
import { movePathNodes, setNodeType } from "../doc/path-edit";
import { IDENTITY } from "../geom/mat";
import { parseSvg } from "../svg/parse";
import { serializeDoc } from "../svg/serialize";

const meta: TextMeta = {
  text: 'SL"O&P',
  font: "anton",
  size: 96,
  letterSpacing: 2.5,
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

  it("stays a title when an edit changes nothing", () => {
    const p = title();
    expect(movePathNodes(p, [], 0, 0)).toBe(p);
  });
});
