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
  let drag: { pointerId: number; startY: number; startRatio: number; sharePx: number } | null =
    null;

  /** What the two panels share: flex gives each `ratio` of this, header included. */
  const sharePx = $derived(Math.max(0, columnPx - STRIP_PX));
  const ratio = $derived(clampRatio(live ?? app.prefs.splitRatio, sharePx, MIN_PANEL_PX));

  $effect(() => {
    const el = column;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      columnPx = entry?.contentRect.height ?? 0;
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  function toggleLayers() {
    setPrefs({ ...app.prefs, layersOpen: !showLayers });
  }

  function down(e: PointerEvent) {
    if (e.button !== 0 || drag) return;
    drag = { pointerId: e.pointerId, startY: e.clientY, startRatio: ratio, sharePx };
    live = ratio;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    live = ratioFromDrag(drag.startRatio, e.clientY - drag.startY, drag.sharePx, MIN_PANEL_PX);
  }

  /** `pointercancel` — a palm rejected mid-drag — keeps the position the drag reached, exactly as
   *  a lift would (CLAUDE.md invariant 6: cancel is treated like up). */
  function up(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag = null;
    const next = live;
    live = null;
    if (next !== null && next !== app.prefs.splitRatio) {
      setPrefs({ ...app.prefs, splitRatio: next });
    }
  }
</script>

<div bind:this={column} class="flex h-full w-60 shrink-0 flex-col border-l border-line bg-panel">
  <PropertiesPanel
    expanded={showProps}
    ontoggle={togglePropsPanel}
    grow={split ? ratio : showProps}
  />
  {#if split}
    <div
      class="group flex h-3 shrink-0 cursor-row-resize touch-none items-center justify-center bg-panel"
      role="separator"
      aria-orientation="horizontal"
      title="Drag to resize the panels"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
    >
      <div class="h-0.5 w-8 rounded-full bg-disabled group-hover:bg-muted"></div>
    </div>
  {/if}
  <LayersPanel
    expanded={showLayers}
    ontoggle={toggleLayers}
    grow={split ? 1 - ratio : showLayers}
  />
</div>
