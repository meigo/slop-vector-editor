<script lang="ts">
  import { untrack } from "svelte";
  import type { Vec } from "../geom/vec";
  import { app, fitArtboard, setView, setViewportSize } from "../state/appState.svelte";
  import { panBy, pinch, screenToDoc, wheelView, zoomAt } from "../state/viewport";
  import NodeView from "./NodeView.svelte";

  let { oncursor }: { oncursor: (p: Vec | null) => void } = $props();

  let host: HTMLDivElement;
  let width = $state(0);
  let height = $state(0);
  let panning = $state(false);
  /** Active pointers in canvas-local px. A plain Map: nothing renders from it. */
  const pointers = new Map<number, Vec>();

  const ready = $derived(width > 0 && height > 0);
  const view = $derived(app.view);
  const artboard = $derived(app.doc.artboard);

  $effect(() => {
    setViewportSize(width, height);
  });

  // Fit when the canvas first gets a size and whenever a document is replaced.
  $effect(() => {
    void app.fitNonce;
    if (ready) untrack(fitArtboard);
  });

  function local(e: { clientX: number; clientY: number }): Vec {
    const r = host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onpointerdown(e: PointerEvent) {
    host.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    // M1 has no editing tools, so every single-pointer drag pans. Milestone 2 routes this through
    // the active tool and keeps panning for Space / middle button / Hand.
    panning = true;
  }

  function onpointermove(e: PointerEvent) {
    const p = local(e);
    oncursor(screenToDoc(app.view, p));
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    if (pointers.size >= 2) {
      // Pinch with the first two pointers; any further finger is ignored.
      const [idA, idB] = [...pointers.keys()];
      if (e.pointerId === idA || e.pointerId === idB) {
        const other = pointers.get(e.pointerId === idA ? idB : idA)!;
        setView(pinch(app.view, prev, other, p, other));
      }
    } else if (panning) {
      setView(panBy(app.view, p.x - prev.x, p.y - prev.y));
    }
    pointers.set(e.pointerId, p);
  }

  function onpointerend(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) panning = false;
  }

  $effect(() => {
    // Non-passive so preventDefault stops page scroll / browser zoom.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView(wheelView(app.view, e, local(e)));
    };
    // Safari desktop reports trackpad pinch as proprietary gesture events, not ctrl+wheel.
    // On iPad the same events accompany touch pinches, which the pointer path already handles.
    let lastScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (pointers.size > 0) return;
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      setView(zoomAt(app.view, local(g), g.scale / lastScale));
      lastScale = g.scale;
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    host.addEventListener("gesturestart", onGestureStart);
    host.addEventListener("gesturechange", onGestureChange);
    return () => {
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("gesturestart", onGestureStart);
      host.removeEventListener("gesturechange", onGestureChange);
    };
  });
</script>

<div
  bind:this={host}
  bind:clientWidth={width}
  bind:clientHeight={height}
  class="relative size-full overflow-hidden bg-ground"
  class:cursor-grabbing={panning}
  style="touch-action: none"
  role="application"
  aria-label="Drawing canvas"
  {onpointerdown}
  {onpointermove}
  onpointerup={onpointerend}
  onpointercancel={onpointerend}
  onpointerleave={() => {
    if (pointers.size === 0) oncursor(null);
  }}
>
  <svg class="absolute inset-0" {width} {height}>
    <defs>
      <pattern id="sv-checker" width="16" height="16" patternUnits="userSpaceOnUse">
        <rect width="16" height="16" fill="#ffffff" />
        <rect width="8" height="8" fill="#d4d4d8" />
        <rect x="8" y="8" width="8" height="8" fill="#d4d4d8" />
      </pattern>
    </defs>
    <g transform="matrix({view.zoom} 0 0 {view.zoom} {view.x} {view.y})">
      <rect x="0" y="0" width={artboard.w} height={artboard.h} fill="url(#sv-checker)" />
      {#if artboard.background}
        <rect
          x="0"
          y="0"
          width={artboard.w}
          height={artboard.h}
          fill={artboard.background.color}
          fill-opacity={artboard.background.opacity}
        />
      {/if}
      {#each app.doc.layers as layer (layer.id)}
        {#if layer.visible}
          <g>
            {#each layer.children as node (node.id)}
              <NodeView {node} />
            {/each}
          </g>
        {/if}
      {/each}
      <rect
        x="0"
        y="0"
        width={artboard.w}
        height={artboard.h}
        fill="none"
        stroke="#000000"
        stroke-opacity="0.35"
        vector-effect="non-scaling-stroke"
        pointer-events="none"
      />
    </g>
  </svg>
</div>
