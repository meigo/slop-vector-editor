import { isValidArtboardSize, type Artboard, type Doc, type Paint } from "./document";

/** Pure document edits: `(doc, args) => doc`. An edit that changes nothing returns the SAME
 *  reference, which is how the undo session knows not to record a step. */

function samePaint(a: Paint | null, b: Paint | null): boolean {
  if (a === null || b === null) return a === b;
  return a.color === b.color && a.opacity === b.opacity;
}

export function setArtboard(doc: Doc, artboard: Artboard): Doc {
  if (!isValidArtboardSize(artboard.w) || !isValidArtboardSize(artboard.h)) {
    throw new RangeError(`Invalid artboard size ${artboard.w} × ${artboard.h}`);
  }
  const cur = doc.artboard;
  if (
    cur.w === artboard.w &&
    cur.h === artboard.h &&
    samePaint(cur.background, artboard.background)
  ) {
    return doc;
  }
  return { ...doc, artboard: { ...artboard } };
}
