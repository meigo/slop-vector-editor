/** What the Layers header's trash button does. With anything selected it deletes the selection,
 *  like ⌫; only with nothing selected does it delete the current layer. Selecting an object makes
 *  its layer current and highlights that row, so a layer-only trash read as "delete this path" and
 *  took the whole layer with it. The last layer can never be deleted. */
export type TrashAction = "selection" | "layer" | "disabled";

export function trashAction(selectionCount: number, layerCount: number): TrashAction {
  if (selectionCount > 0) return "selection";
  return layerCount > 1 ? "layer" : "disabled";
}
