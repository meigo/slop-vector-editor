/** Spec (M2e) §4: the status bar shows the title of whatever the mouse is over. Structural
 *  parameter type so this stays testable without a DOM. */
export type HintTarget = {
  closest(selector: string): { getAttribute(name: string): string | null } | null;
};

export function hintFrom(target: HintTarget | null, pointerType: string): string | null {
  if (pointerType !== "mouse" || !target) return null;
  const title = target.closest("[title]")?.getAttribute("title");
  return title ? title : null;
}
