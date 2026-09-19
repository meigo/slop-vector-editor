<script lang="ts">
  import { ChevronLeft, ChevronRight } from "@lucide/svelte";
  import { dockDown, dockUp, type DockPress } from "../input/dock";
  import { app, setDock, setPrefs, toggleSnap, type DockState } from "../state/appState.svelte";

  const KEYS: readonly (keyof DockState)[] = ["shift", "alt"];
  const LABELS: Record<keyof DockState, string> = { shift: "Shift", alt: "Alt" };
  /** Shift and Alt stand in for keys a desktop user simply presses, so they start hidden. `null`
   *  means nobody has decided yet: the first finger or Pencil on the canvas opens them once, and
   *  records that, so it never fights a choice the user has made (spec: the dock is collapsible). */
  const expanded = $derived(app.prefs.dockExpanded === true);

  $effect(() => {
    const direct = app.lastPointerType === "touch" || app.lastPointerType === "pen";
    if (direct && app.prefs.dockExpanded === null) {
      setPrefs({ ...app.prefs, dockExpanded: true });
    }
  });

  function toggleExpanded() {
    setPrefs({ ...app.prefs, dockExpanded: !expanded });
  }

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
  {#if expanded}
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
  {/if}
  <button
    class="flex h-10 w-6 items-center justify-center rounded text-muted hover:bg-raised"
    style="touch-action: none"
    aria-expanded={expanded}
    title={expanded ? "Hide the Shift and Alt keys" : "Show the Shift and Alt keys"}
    aria-label={expanded ? "Hide the Shift and Alt keys" : "Show the Shift and Alt keys"}
    onclick={toggleExpanded}
    onpointerdown={(e) => e.preventDefault()}
  >
    {#if expanded}<ChevronRight size={16} />{:else}<ChevronLeft size={16} />{/if}
  </button>
</div>
