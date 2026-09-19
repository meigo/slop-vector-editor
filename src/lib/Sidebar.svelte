<script lang="ts">
  import { clampRatio, MIN_PANEL_PX, propsOpen, ratioFromDrag, STRIP_PX } from "./split";
  import { app, setPrefs, togglePropsPanel } from "../state/appState.svelte";
  import LayersPanel from "./LayersPanel.svelte";
  import PropertiesPanel from "./PropertiesPanel.svelte";

  /** Spec (M8): two panels with raised headers, a draggable divider between them, and a ratio that
   *  persists. Properties follows the selection unless the user overrode it; Layers is a plain
   *  toggle. The divider only exists while both are open — with one collapsed there is nothing to
   *  distribute, and an inert strip between two bars would be dead space that looks draggable. */
  const showProps = $derived(propsOpen(app.propsOverride, app.selection.length > 0));
  const showLayers = $derived(app.prefs.layersOpen);
  const split = $derived(showProps && showLayers);

  let column = $state<HTMLElement | null>(null);
  let columnPx = $state(0);
  /** The ratio being dragged right now; null when no drag is running and the pref rules. */
  let live = $state<number | null>(null);
  let dragId: number | null = null;
  let startY = 0;
  let startRatio = 0;

  /** What the two panels share: flex gives each `ratio` of this, header included. */
  const sharePx = $derived(Math.max(0, columnPx - STRIP_PX));
  /** Before the observer has measured, the stored ratio is better than an even split. */
  const ratio = $derived(
    sharePx > 0
      ? clampRatio(live ?? app.prefs.splitRatio, sharePx, MIN_PANEL_PX)
      : (live ?? app.prefs.splitRatio),
  );

  const flexFor = (share: number, open: boolean, other: boolean) =>
    !open ? "0 0 auto" : other ? `${share} 1 0%` : "1 1 0%";

  $effect(() => {
    const el = column;
    if (!el) return;
    // Measure once synchronously: a hidden instance becoming visible has already painted, so
    // waiting for the observer's first callback would show an even split for a frame.
    columnPx = el.getBoundingClientRect().height;
    const ro = new ResizeObserver(([entry]) => {
      columnPx = entry?.contentRect.height ?? 0;
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  /** The strip lives inside `{#if split}`, and a collapse can happen mid-drag — Escape, undo or a
   *  delete all flip the selection's emptiness. An unmounted element releases pointer capture
   *  silently and its listeners go with it, so without this the drag state would be stranded:
   *  `down` would refuse to start another, and `move` would resize on a bare hover. */
  $effect(() => {
    if (!split) endDrag();
  });

  function toggleLayers() {
    setPrefs({ ...app.prefs, layersOpen: !showLayers });
  }

  function endDrag() {
    dragId = null;
    live = null;
  }

  function down(e: PointerEvent) {
    if (e.button !== 0 || dragId !== null) return;
    dragId = e.pointerId;
    startY = e.clientY;
    startRatio = ratio;
    live = ratio;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Capture is a convenience; moves still arrive while the pointer stays on the strip.
    }
    e.preventDefault();
  }

  function move(e: PointerEvent) {
    if (dragId === null || live === null || e.pointerId !== dragId) return;
    // `sharePx` is read live: a notice appearing or a window resize mid-drag changes it.
    live = ratioFromDrag(startRatio, e.clientY - startY, sharePx, MIN_PANEL_PX);
  }

  /** `pointercancel` — a palm rejected mid-drag — keeps the position the drag reached, exactly as
   *  a lift would (CLAUDE.md invariant 6: cancel is treated like up). */
  function up(e: PointerEvent) {
    if (dragId === null || e.pointerId !== dragId) return;
    const next = live;
    endDrag();
    if (next !== null && next !== app.prefs.splitRatio) {
      setPrefs({ ...app.prefs, splitRatio: next });
    }
  }
</script>

<div bind:this={column} class="flex h-full w-60 shrink-0 flex-col border-l border-line bg-panel">
  <PropertiesPanel
    expanded={showProps}
    ontoggle={togglePropsPanel}
    flex={flexFor(ratio, showProps, showLayers)}
  />
  {#if split}
    <div
      class="group flex h-3 shrink-0 cursor-row-resize touch-none items-center justify-center bg-panel"
      role="separator"
      aria-orientation="horizontal"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      title="Drag to resize the panels"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
      onlostpointercapture={up}
    >
      <div class="h-0.5 w-8 rounded-full bg-disabled group-hover:bg-muted"></div>
    </div>
  {/if}
  <LayersPanel
    expanded={showLayers}
    ontoggle={toggleLayers}
    flex={flexFor(1 - ratio, showLayers, showProps)}
  />
</div>
