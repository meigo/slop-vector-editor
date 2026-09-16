/** SVG number output: 6 decimals is far below any visible difference and keeps float noise
 *  (0.30000000000000004) out of files. */
export function fmt(n: number): string {
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? "0" : String(r);
}
