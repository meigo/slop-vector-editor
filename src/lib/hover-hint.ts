/** Spec (M2e) §4 and (M5) §5: the status bar shows the title of whatever the mouse is over — and,
 *  on a device with no hover, of whatever was last pressed. iPadOS shows no tooltip for a `title`,
 *  so without this an icon-only bar explains nothing and a disabled control never says why.
 *  Structural parameter type so this stays testable without a DOM. */
export type HintTarget = {
  closest(selector: string): { getAttribute(name: string): string | null } | null;
};

export function hintFrom(target: HintTarget | null, _pointerType: string): string | null {
  if (!target) return null;
  const title = target.closest("[title]")?.getAttribute("title");
  return title ? title : null;
}
