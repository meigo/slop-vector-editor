import type { Doc, Node } from "../doc/document";
import { insertNodes } from "../doc/edits";
import { targetLayerId } from "../doc/tree";
import { nodeBounds } from "../geom/bounds";
import { boxCenter, unionBox, type Box } from "../geom/box";
import { IDENTITY } from "../geom/mat";
import { parseSvg, type ParseResult } from "../svg/parse";
import { serializeDoc } from "../svg/serialize";

export const PASTE_STEP = 10;
export const NOT_SVG = "The clipboard doesn't contain an SVG drawing.";
export const EMPTY = "The clipboard drawing is empty.";
export const NO_LAYER = "Every layer is hidden or locked — there is nowhere to paste.";

/** The in-app copy: what we last copied, and how many times it has been pasted since. */
export type Clip = { text: string; pastes: number };
export type PastePlan = { doc: Doc; ids: string[]; dropped: string[]; clip: Clip | null };
export type PasteError = { error: string };

export function isPasteError(r: PastePlan | PasteError): r is PasteError {
  return "error" in r;
}

export function looksLikeSvg(text: string): boolean {
  return /<svg[\s>/]/i.test(text);
}

/** The selected top-level nodes as a standalone SVG in our own format, coordinates unchanged. */
export function clipboardText(doc: Doc, ids: readonly string[]): string | null {
  const wanted = new Set(ids);
  const nodes = doc.layers.flatMap((l) => l.children.filter((n) => wanted.has(n.id)));
  if (nodes.length === 0) return null;
  return serializeDoc({
    ...doc,
    artboard: { ...doc.artboard, background: null },
    layers: [{ id: "clip", name: "Clipboard", visible: true, locked: false, children: nodes }],
  });
}

function boundsOf(nodes: readonly Node[]): Box | null {
  let box: Box | null = null;
  for (const n of nodes) box = unionBox(box, nodeBounds(n, IDENTITY));
  return box;
}

function intersects(a: Box, b: Box): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

/** Spec (M2b) §2.3. `view` is the visible canvas area in document coordinates. */
export function planPaste(
  doc: Doc,
  text: string,
  clip: Clip | null,
  view: Box,
): PastePlan | PasteError {
  let parsed: ParseResult;
  try {
    parsed = parseSvg(text);
  } catch {
    return { error: NOT_SVG };
  }
  const nodes = parsed.doc.layers.flatMap((l) => l.children);
  const bounds = boundsOf(nodes);
  if (nodes.length === 0 || !bounds) return { error: EMPTY };
  const layerId = targetLayerId(doc);
  if (!layerId) return { error: NO_LAYER };

  const own = clip !== null && text === clip.text;
  const n = own ? clip.pastes + 1 : 0;
  const vc = boxCenter(view);
  const bc = boxCenter(bounds);
  let dx = vc.x - bc.x;
  let dy = vc.y - bc.y;
  if (own) {
    const step = PASTE_STEP * n;
    if (intersects({ ...bounds, x: bounds.x + step, y: bounds.y + step }, view)) {
      dx = step;
      dy = step;
    }
  }
  const r = insertNodes(doc, layerId, nodes, dx, dy);
  return {
    doc: r.doc,
    ids: r.ids,
    dropped: parsed.dropped,
    clip: own ? { text, pastes: n } : clip,
  };
}
