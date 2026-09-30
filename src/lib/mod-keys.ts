/** Shortcut labels for this platform: ⌘ on Apple devices, Ctrl elsewhere. Shared by the top bar's
 *  menus and the context menu, which hard-coded ⌘ on Windows and Linux (review L20). */
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? "⌘" : "Ctrl+";
export const SHIFT_MOD = isMac ? "⇧⌘" : "Ctrl+Shift+";
