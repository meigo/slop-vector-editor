export type ToolId = "select" | "rect" | "ellipse" | "line" | "polygon" | "pen" | "node" | "hand";

/** Modifier state for tools: physical keys combined with the on-screen modifier dock. */
export type Mods = { shift: boolean; alt: boolean };

export const NO_MODS: Mods = { shift: false, alt: false };
