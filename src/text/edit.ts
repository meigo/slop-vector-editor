/** Pure helpers for on-canvas text editing (spec M22 §1, §4). Indices are code points unless a
 *  function says UTF-16. */

export type CaretStop = { x: number; baseline: number; top: number; bottom: number; line: number };

/** A title being edited on the canvas (spec M22 §2). Indices are code points into the raw string,
 *  newlines included; `anchor === focus` is a caret. */
export type TextEdit = { id: string; anchor: number; focus: number };

/** UTF-16 offset → code-point index (an offset inside a surrogate pair rounds DOWN). */
export function toCodePoint(text: string, utf16: number): number {
  let cp = 0;
  let u = 0;
  for (const ch of text) {
    const next = u + ch.length;
    if (utf16 < next) return cp;
    u = next;
    cp++;
  }
  return cp;
}

/** Code-point index → UTF-16 offset. */
export function toUtf16(text: string, cp: number): number {
  let u = 0;
  let i = 0;
  for (const ch of text) {
    if (i >= cp) break;
    u += ch.length;
    i++;
  }
  return u;
}

/** The edited span of an edit, in code points of the old string, and the length change. */
function editSpan(oldText: string, newText: string) {
  const a = Array.from(oldText);
  const b = Array.from(newText);
  const max = Math.min(a.length, b.length);
  let pre = 0;
  while (pre < max && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < max - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  return { start: pre, end: a.length - suf, delta: b.length - a.length };
}

/** The same rule for one index; null when it was inside the edited span. */
export function remapIndex(oldText: string, newText: string, i: number): number | null {
  const { start, end, delta } = editSpan(oldText, newText);
  if (i < start) return i;
  if (i < end) return null;
  return i + delta;
}

/** Overrides after an edit: common prefix/suffix (code points) bound the edited span; keys before
 *  it stay, keys inside it are dropped, keys after it shift by the length change. Returns the SAME
 *  object when nothing moves or drops (invariant 1). */
export function remapOverrides<T>(
  oldText: string,
  newText: string,
  o: Record<number, T>,
): Record<number, T> {
  const { start, end, delta } = editSpan(oldText, newText);
  let changed = false;
  const out: Record<number, T> = {};
  for (const [k, v] of Object.entries(o)) {
    const i = Number(k);
    if (i < start) out[i] = v;
    else if (i < end) changed = true;
    else {
      if (delta !== 0) changed = true;
      out[i + delta] = v;
    }
  }
  return changed ? out : o;
}

function lineOf(stops: readonly CaretStop[]): Map<number, number[]> {
  const lines = new Map<number, number[]>();
  stops.forEach((s, i) => {
    const l = lines.get(s.line);
    if (l) l.push(i);
    else lines.set(s.line, [i]);
  });
  return lines;
}

function nearestX(stops: readonly CaretStop[], idx: readonly number[], x: number): number {
  let best = idx[0];
  for (const i of idx) if (Math.abs(stops[i].x - x) < Math.abs(stops[best].x - x)) best = i;
  return best;
}

/** Index of the stop nearest `p` (title-local): nearest line by baseline-to-mid distance, then
 *  nearest x on that line. `stops[i]` is the stop for index i. -1 for no stops. */
export function indexAt(stops: readonly CaretStop[], p: { x: number; y: number }): number {
  if (stops.length === 0) return -1;
  let bestLine: number[] = [];
  let bestD = Infinity;
  for (const idx of lineOf(stops).values()) {
    const s = stops[idx[0]];
    const d = Math.abs((s.top + s.bottom) / 2 - p.y);
    if (d < bestD) {
      bestD = d;
      bestLine = idx;
    }
  }
  return nearestX(stops, bestLine, p.x);
}

/** ↑ (dir −1) / ↓ (+1) from `index` towards `goalX`; before the first line → 0, past the last →
 *  stops.length − 1. */
export function verticalMove(
  stops: readonly CaretStop[],
  index: number,
  dir: -1 | 1,
  goalX: number,
): number {
  if (stops.length === 0) return 0;
  const target = stops[index].line + dir;
  const idx = lineOf(stops).get(target);
  if (!idx) return dir < 0 ? 0 : stops.length - 1;
  return nearestX(stops, idx, goalX);
}

const WORD = /[\p{L}\p{N}_]/u;
const SPACE = /[^\S\r\n]/u;

/** Word bounds around `index` (code points): a run of letters/digits (`\p{L}\p{N}_`), else a run
 *  of whitespace (not newlines), else the single character. */
export function wordAt(text: string, index: number): { start: number; end: number } {
  const cs = Array.from(text);
  if (cs.length === 0) return { start: 0, end: 0 };
  const i = Math.min(Math.max(index, 0), cs.length - 1);
  const test = WORD.test(cs[i]) ? WORD : SPACE.test(cs[i]) ? SPACE : null;
  if (!test) return { start: i, end: i + 1 };
  let start = i;
  let end = i + 1;
  while (start > 0 && test.test(cs[start - 1])) start--;
  while (end < cs.length && test.test(cs[end])) end++;
  return { start, end };
}

/** One rectangle per line covered by [a, b) (order-free), title-local:
 *  { x0, x1, top, bottom }. Empty for a caret. A selection that crosses a line end extends that
 *  line's rectangle to its end stop. */
export function selectionRects(
  stops: readonly CaretStop[],
  a: number,
  b: number,
): { x0: number; x1: number; top: number; bottom: number }[] {
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(stops.length - 1, Math.max(a, b));
  if (lo >= hi) return [];
  const rects: { x0: number; x1: number; top: number; bottom: number }[] = [];
  for (const idx of lineOf(stops).values()) {
    const first = idx[0];
    const last = idx[idx.length - 1];
    if (last < lo || first > hi) continue;
    const s = stops[first];
    rects.push({
      x0: stops[Math.max(first, lo)].x,
      x1: stops[Math.min(last, hi)].x,
      top: s.top,
      bottom: s.bottom,
    });
  }
  // A font's ascender-to-descender can exceed the line pitch: meet adjacent rects, don't overlap.
  for (let i = 0; i + 1 < rects.length; i++) {
    if (rects[i].bottom > rects[i + 1].top) {
      const mid = (rects[i].bottom + rects[i + 1].top) / 2;
      rects[i].bottom = mid;
      rects[i + 1].top = mid;
    }
  }
  return rects;
}
