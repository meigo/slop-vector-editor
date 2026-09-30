/** The document's name (2026-09-30): `app.fileName` is always a full `<name>.svg`; the Name fields
 *  show it without the extension. Pure, so the rules are testable without a DOM. */

const EXT = /\.svg$/i;
/** Characters no common file system accepts in a name, plus control characters. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[/\\:*?"<>|\u0000-\u001f]/g;

export const DEFAULT_NAME = "Untitled";

/** A typed name as a file name: forbidden characters removed, trimmed, `.svg` added once. */
export function svgFileName(input: string): string {
  const base = input.replace(FORBIDDEN, "").trim().replace(EXT, "").trim();
  return `${base === "" ? DEFAULT_NAME : base}.svg`;
}

/** What a Name field shows for a file name. */
export function baseName(fileName: string): string {
  return fileName.replace(EXT, "");
}
