<script lang="ts">
  import { dockDown, dockUp, type DockPress } from "../input/dock";
  import { app, setDock, toggleSnap, type DockState } from "../state/appState.svelte";

  const KEYS: readonly (keyof DockState)[] = ["shift", "alt"];
  const LABELS: Record<keyof DockState, string> = { shift: "Shift", alt: "Alt" };
  /** In-progress presses; not rendered, so not reactive. */
  const presses: Partial<Record<keyof DockState, DockPress>> = {};

  function down(key: keyof DockState, e: PointerEvent) {
    e.preventDefault();
    try {
      if (e.currentTarget instanceof Element) e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a convenience here; the release still arrives on this button.
    }
    const r = dockDown(app.dock[key], performance.now());
    presses[key] = r.press;
    setDock(key, r.state);
  }

  function up(key: keyof DockState) {
    const press = presses[key];
    if (!press) return;
    delete presses[key];
    setDock(key, dockUp(press, performance.now()));
  }
</script>

<div
  class={[
    "absolute bottom-3 z-10 flex gap-1 rounded-lg border border-line bg-panel p-1 shadow-lg",
    app.propertiesOpen ? "right-3 max-[900px]:right-63" : "right-3",
  ]}
  role="toolbar"
  aria-label="Modifier keys"
>
  <button
    class={["h-10 w-14 rounded border border-line text-xs select-none", app.prefs.snap && "ui-on"]}
    style="touch-action: none"
    aria-pressed={app.prefs.snap}
    title="Snap to the artboard and objects (%)"
    onclick={toggleSnap}
    onpointerdown={(e) => e.preventDefault()}
  >
    Snap
  </button>
  {#each KEYS as key (key)}
    <button
      class={[
        "h-10 w-14 rounded border border-line text-xs select-none",
        app.dock[key] !== "off" && "ui-on",
      ]}
      style="touch-action: none"
      aria-pressed={app.dock[key] !== "off"}
      title="Hold, or tap to lock, {LABELS[key]}"
      onpointerdown={(e) => down(key, e)}
      onpointerup={() => up(key)}
      onpointercancel={() => up(key)}
      onlostpointercapture={() => up(key)}
    >
      {LABELS[key]}
    </button>
  {/each}
</div>
