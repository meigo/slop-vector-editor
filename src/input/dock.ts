/** On-screen Shift/Alt for touch: press-and-hold works like a key, a quick tap latches. */
export type Latch = "off" | "held" | "latched";
export type DockPress = { before: Latch; at: number };

export const TAP_MS = 250;

export function dockDown(current: Latch, now: number): { state: Latch; press: DockPress } {
  return { state: "held", press: { before: current, at: now } };
}

export function dockUp(press: DockPress, now: number): Latch {
  if (now - press.at < TAP_MS) return press.before === "latched" ? "off" : "latched";
  return "off";
}

export function latchOn(l: Latch): boolean {
  return l !== "off";
}
