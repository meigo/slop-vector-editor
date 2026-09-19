export type ToolId = "select" | "rect" | "ellipse" | "line" | "polygon" | "pen" | "node" | "hand";

/** Modifier state for tools: physical keys combined with the on-screen modifier dock.
 *
 *  `shift` and `alt` are what a tool should honour. `shiftLatched` says Shift is on *only* because
 *  the dock's latch is on — nobody is holding a key. The two are different questions: a held key
 *  means "I am in the middle of adding to the selection", while a latch is a mode set earlier and
 *  left on, and on a device with no keyboard it cannot be released by letting go. */
export type Mods = { shift: boolean; alt: boolean; shiftLatched: boolean };

export const NO_MODS: Mods = { shift: false, alt: false, shiftLatched: false };
