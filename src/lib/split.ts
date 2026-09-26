/** The Properties/Layers split in the sidebar (spec M8 §4–§5). Pure: no store, no DOM, no Svelte —
 *  every number the divider and the two chevrons need lives here and is unit-tested. */

/** The smallest body a panel keeps when the divider is dragged to an extreme: about three layer
 *  rows at `h-8`. */
export const MIN_BODY_PX = 120;

/** A panel header's height, and the divider strip's. */
export const HEADER_PX = 40;
export const STRIP_PX = 12;

/** A panel's smallest whole height. Flex distributes whole sections, headers included, so this —
 *  not `MIN_BODY_PX` — is what the ratio is clamped against, and the share it divides is the column
 *  minus the strip. Clamping against the body alone left the losing panel 40px short. */
export const MIN_PANEL_PX = HEADER_PX + MIN_BODY_PX;

/** Keep `ratio` — Properties' share of the body — inside the range that leaves both panels at least
 *  `minPx`. A body too short for two minimums splits evenly instead: honouring the ratio there
 *  would starve one side completely, and half of too little is still something. */
export function clampRatio(ratio: number, bodyPx: number, minPx: number): number {
  if (!Number.isFinite(ratio) || !Number.isFinite(bodyPx) || bodyPx < 2 * minPx) return 0.5;
  const min = minPx / bodyPx;
  return Math.min(Math.max(ratio, min), 1 - min);
}

/** The ratio a drag lands on. `deltaPx` is the pointer's downward travel since pointer-down.
 *  Properties — whose share the ratio is — sits below the divider, so travel down gives it less. */
export function ratioFromDrag(
  startRatio: number,
  deltaPx: number,
  bodyPx: number,
  minPx: number,
): number {
  if (!Number.isFinite(bodyPx) || bodyPx <= 0) return clampRatio(startRatio, bodyPx, minPx);
  return clampRatio(startRatio - deltaPx / bodyPx, bodyPx, minPx);
}

/** Properties is open when the user has said so, and otherwise whenever something is selected —
 *  the panel's whole content is about the selection, so with none it has nothing to say. */
export function propsOpen(override: boolean | null, hasSelection: boolean): boolean {
  return override ?? hasSelection;
}

/** A decision about the Properties panel was made for one selection state and does not survive the
 *  other. Returns the same value when nothing flipped, so the caller can skip the write. */
export function clearedOverride(
  override: boolean | null,
  wasEmpty: boolean,
  isEmpty: boolean,
): boolean | null {
  return wasEmpty === isEmpty ? override : null;
}
