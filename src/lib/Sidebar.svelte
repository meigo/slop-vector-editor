<script lang="ts">
  import { clampSidebarWidth, resizedSidebarWidth } from "./panel-layout";
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

  /** The sidebar's own width (spec M10e §3). The drag mechanics are the vertical divider's, one
   *  axis over: a pointer-down snapshot, a recompute per move (never an accumulation), capture so
   *  the pointer can leave the 8px strip, and `pointercancel` treated exactly like an up
   *  (invariant 6). One pref write per drag, on release, not per move. */
  let gripping = $state(false);
  let gripId: number | null = null;
  let gripStartX = 0;
  let gripStartPx = 0;
  /** The width being dragged right now; null when no drag is running and the pref rules. */
  let liveWidth = $state<number | null>(null);
  const widthPx = $derived(liveWidth ?? app.prefs.sidebarPx);

  /** A width stored on a wider screen, or left over from before the window shrank, would otherwise
   *  leave no canvas at all. The ceiling is half the viewport, and it can only be applied where the
   *  viewport is known — here, not in `sanitizePrefs`. */
  $effect(() => {
    const onResize = () => {
      const next = clampSidebarWidth(app.prefs.sidebarPx, window.innerWidth);
      if (next !== app.prefs.sidebarPx) setPrefs({ ...app.prefs, sidebarPx: next });
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });

  function commitWidth(next: number | null) {
    gripping = false;
    gripId = null;
    liveWidth = null;
    if (next !== null && next !== app.prefs.sidebarPx) setPrefs({ ...app.prefs, sidebarPx: next });
  }

  function gripDown(e: PointerEvent) {
    if (e.button !== 0 || gripId !== null) return;
    gripId = e.pointerId;
    gripping = true;
    gripStartX = e.clientX;
    gripStartPx = widthPx;
    liveWidth = widthPx;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Capture is a convenience; moves still arrive while the pointer stays on the strip.
    }
    e.preventDefault();
  }

  function gripMove(e: PointerEvent) {
    if (gripId === null || e.pointerId !== gripId) return;
    liveWidth = resizedSidebarWidth(gripStartPx, gripStartX, e.clientX, window.innerWidth);
  }

  function gripUp(e: PointerEvent) {
    if (gripId === null || e.pointerId !== gripId) return;
    commitWidth(liveWidth);
  }

  /** The grip is a real button, so it is reachable by Tab — the one keyboard route to a width on a
   *  machine with no mouse. Left widens, because left is where the panel's edge goes. */
  function gripKey(e: KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.shiftKey ? 24 : 8;
    commitWidth(
      clampSidebarWidth(widthPx + (e.key === "ArrowLeft" ? step : -step), window.innerWidth),
    );
  }

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

<div
  bind:this={column}
  class="relative flex h-full shrink-0 flex-col border-l border-line bg-panel"
  style="width: {widthPx}px"
>
  <!-- The grip sits ON the left border, absolutely positioned, so it costs the panel no content
       width (spec M10e §3, matching every sibling slop app). 8px to hit, a 2px tint to see.
       `touch-none` is load-bearing: without it iPadOS reads the drag as a scroll and cancels the
       pointer stream mid-gesture. -->
  <button
    type="button"
    class="group absolute inset-y-0 -left-1 z-20 w-2 cursor-ew-resize touch-none"
    aria-label="Resize the sidebar ({widthPx} pixels wide)"
    title="Drag to resize the sidebar"
    onpointerdown={gripDown}
    onpointermove={gripMove}
    onpointerup={gripUp}
    onpointercancel={gripUp}
    onlostpointercapture={gripUp}
    onkeydown={gripKey}
  >
    <span
      class={[
        "mx-auto block h-9 w-0.5 rounded-full group-hover:bg-muted group-focus-visible:bg-muted",
        gripping ? "bg-muted" : "bg-transparent",
      ]}
      aria-hidden="true"
    ></span>
  </button>
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
