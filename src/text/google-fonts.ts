/** Google Fonts faces (spec M20 §2, §3): parsing a family's `METADATA.pb` into its faces,
 *  choosing which face to draw for a (weight, italic) request, and downloading the metadata and
 *  face files themselves. Nothing here imports opentype.js (invariant 40) — callers hand the
 *  bytes this returns to `src/text/font.ts`. */

export type FaceEntry = { style: "normal" | "italic"; weight: number; filename: string };

export const GOOGLE_FONTS_BASE = "https://cdn.jsdelivr.net/gh/google/fonts@main/";

function unescapeProtoString(s: string): string {
  return s.replace(/\\(.)/g, "$1");
}

/** One field's quoted string value out of a `fonts { … }` block's text, escaped-quote aware
 *  (a `copyright` field routinely contains `\"…\"`). */
function stringField(block: string, key: string): string | null {
  const m = new RegExp(`${key}:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(block);
  return m ? unescapeProtoString(m[1]) : null;
}

function numberField(block: string, key: string): number | null {
  const m = new RegExp(`${key}:\\s*(-?\\d+(?:\\.\\d+)?)`).exec(block);
  return m ? Number(m[1]) : null;
}

/** Parses the `fonts { … }` blocks of a METADATA.pb (protobuf text format), one per face.
 *  Ignores every other top-level field (`subsets`, `axes`, `source`, …) and every block whose
 *  `style` isn't `normal`/`italic` or that has no `weight`/`filename`. Blocks are flat — no
 *  nested `{ … }` — so a non-greedy match up to the first `}` is exact. De-duplicated by
 *  filename, keeping the first occurrence. */
export function parseMetadata(pb: string): FaceEntry[] {
  const seen = new Map<string, FaceEntry>();
  const blockRe = /fonts\s*\{([\s\S]*?)\}/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(pb))) {
    const block = m[1];
    const style = stringField(block, "style");
    const weight = numberField(block, "weight");
    const filename = stringField(block, "filename");
    if (style !== "normal" && style !== "italic") continue;
    if (weight === null || filename === null) continue;
    if (!seen.has(filename)) seen.set(filename, { style, weight, filename });
  }
  return Array.from(seen.values());
}

/** A variable face covers every weight on its axis (spec M20 §3): its filename names the axis
 *  in brackets, e.g. "Lora[wght].ttf" or "Lora-Italic[wght].ttf". */
export function isVariableFile(filename: string): boolean {
  return filename.includes("[");
}

export function hasItalic(faces: readonly FaceEntry[]): boolean {
  return faces.some((f) => f.style === "italic");
}

/** Chooses the face for a (weight, italic) request (spec M20 §3). Keeps the entries matching the
 *  requested style, falling back to "normal" when italic was asked for but the family has none
 *  (the toggle is disabled in that case anyway; an imported file asking for it must not fail). A
 *  variable face in that pool covers every weight, so it's returned outright. Otherwise the exact
 *  static weight wins, else the nearest — ties going to the heavier of the two. */
export function chooseFace(
  faces: readonly FaceEntry[],
  weight: number,
  italic: boolean,
): FaceEntry | null {
  if (faces.length === 0) return null;
  const wantStyle = italic && hasItalic(faces) ? "italic" : "normal";
  const pool = faces.filter((f) => f.style === wantStyle);
  const candidates = pool.length > 0 ? pool : faces;

  const variable = candidates.find((f) => isVariableFile(f.filename));
  if (variable) return variable;

  let best = candidates[0];
  let bestDiff = Math.abs(best.weight - weight);
  for (const f of candidates.slice(1)) {
    const diff = Math.abs(f.weight - weight);
    if (diff < bestDiff || (diff === bestDiff && f.weight > best.weight)) {
      best = f;
      bestDiff = diff;
    }
  }
  return best;
}

export type Fetcher = (
  url: string,
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

const defaultFetcher: Fetcher = (url) => fetch(url);

/** `dir`'s own family folder, e.g. "ofl/lora" → "Lora" — used only to name the family in an
 *  error message when the caller has no `GoogleFamily` at hand (both download functions take
 *  just the directory, spec M20 §2). */
function dirLabel(dir: string): string {
  const id = dir.split("/").pop() ?? dir;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function downloadError(dir: string): Error {
  return new Error(`Couldn't download ${dirLabel(dir)} — check your connection`);
}

export async function fetchMetadata(
  dir: string,
  fetcher: Fetcher = defaultFetcher,
): Promise<FaceEntry[]> {
  let res;
  try {
    res = await fetcher(`${GOOGLE_FONTS_BASE}${dir}/METADATA.pb`);
  } catch {
    throw downloadError(dir);
  }
  if (!res.ok) throw downloadError(dir);
  const text = await res.text();
  return parseMetadata(text);
}

/** Downloads one face file. `filename` is URL-encoded — a variable face's name contains `[`, `]`
 *  and, for a multi-axis family, `,`. */
export async function fetchFaceFile(
  dir: string,
  filename: string,
  fetcher: Fetcher = defaultFetcher,
): Promise<ArrayBuffer> {
  let res;
  try {
    res = await fetcher(`${GOOGLE_FONTS_BASE}${dir}/${encodeURIComponent(filename)}`);
  } catch {
    throw downloadError(dir);
  }
  if (!res.ok) throw downloadError(dir);
  return res.arrayBuffer();
}
