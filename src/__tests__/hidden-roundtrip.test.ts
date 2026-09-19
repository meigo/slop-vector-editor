import { describe, expect, it } from "vitest";
import { isHidden, isLocked, type Shape } from "../doc/document";
import { setNodeHidden, setNodeLocked } from "../doc/edits";
import { parseSvg } from "../svg/parse";
import { serializeDoc } from "../svg/serialize";

const kids = (svg: string) => {
  const r = parseSvg(svg);
  return { r, nodes: r.doc.layers.flatMap((l) => l.children) };
};

describe("hidden and locked content survives an import", () => {
  it("keeps every spelling of hidden instead of deleting it", () => {
    const { r, nodes } = kids(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <rect x="0" y="0" width="10" height="10" fill="#ff0000"/>
      <rect x="20" y="0" width="10" height="10" fill="#00ff00" display="none"/>
      <rect x="40" y="0" width="10" height="10" fill="#0000ff" style="display:none"/>
      <rect x="60" y="0" width="10" height="10" fill="#ffff00" visibility="hidden"/>
    </svg>`);
    expect(nodes).toHaveLength(4);
    expect(nodes.map((n) => isHidden(n))).toEqual([false, true, true, true]);
    expect((nodes[0] as Shape).style.fill?.color).toBe("#ff0000");
    expect(r.dropped).toEqual([]);
  });

  it("keeps a hidden group's children, and marks only the group", () => {
    // The outer <g> is read as a layer (that is how this app stores layers), so the group under
    // test has to be one level in.
    const { nodes } = kids(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <g><g display="none"><rect x="0" y="0" width="5" height="5" fill="#ff00ff"/></g></g>
    </svg>`);
    expect(nodes).toHaveLength(1);
    const g = nodes[0];
    expect(isHidden(g)).toBe(true);
    expect(g.kind === "group" && g.children).toHaveLength(1);
    expect(g.kind === "group" && isHidden(g.children[0])).toBe(false);
  });

  it("reads both spellings of locked", () => {
    const { nodes } = kids(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <rect x="0" y="0" width="5" height="5" data-sv-locked=""/>
      <rect x="10" y="0" width="5" height="5" sodipodi:insensitive="true"/>
    </svg>`);
    expect(nodes.map((n) => isLocked(n))).toEqual([true, true]);
  });

  it("reports a nested visibility override rather than changing the file silently", () => {
    const { r } = kids(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <g><g visibility="hidden"><rect x="0" y="0" width="5" height="5" visibility="visible"/></g></g>
    </svg>`);
    expect(r.dropped).toContain("nested visibility override");
  });

  it("round-trips both flags through our own writer", () => {
    const src = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <rect x="0" y="0" width="10" height="10" fill="#ff0000"/>
      <rect x="20" y="0" width="10" height="10" fill="#00ff00"/>
    </svg>`;
    const base = parseSvg(src).doc;
    const [a, b] = base.layers[0].children.map((n) => n.id);
    const edited = setNodeLocked(setNodeHidden(base, [a], true), [b], true);
    const back = parseSvg(serializeDoc(edited)).doc.layers[0].children;
    expect(back.map((n) => [isHidden(n), isLocked(n)])).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it("hiding and showing again leaves a byte-identical file", () => {
    const base = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect x="0" y="0" width="10" height="10" fill="#ff0000"/>
      </svg>`,
    ).doc;
    const id = base.layers[0].children[0].id;
    const there = serializeDoc(base);
    const andBack = serializeDoc(setNodeHidden(setNodeHidden(base, [id], true), [id], false));
    expect(andBack).toBe(there);
  });
});
