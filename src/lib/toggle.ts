/** Spec (M2d) §4: toggles are buttons with aria-pressed; a mixed selection shows accent text. */
export type ToggleValue = boolean | "mixed";

export type ToggleView = { pressed: "true" | "false" | "mixed"; on: boolean; mixed: boolean };

export function toggleView(v: ToggleValue): ToggleView {
  return {
    pressed: v === "mixed" ? "mixed" : v ? "true" : "false",
    on: v === true,
    mixed: v === "mixed",
  };
}

/** A click turns a mixed or off toggle on, and an on toggle off. */
export function nextToggle(v: ToggleValue): boolean {
  return v !== true;
}
