<svelte:options namespace="svg" />

<script lang="ts">
  import type { Vec } from "../geom/vec";
  import { app } from "../state/appState.svelte";
  import { docToScreen } from "../state/viewport";
  import { selectionFrame } from "../tools/frame";
  import { frameOutline, handlePositions, handleSize, RESIZE_HANDLES } from "../tools/gizmo";

  const LINE = "stroke: var(--color-accent); fill: none";
  const KNOB = "stroke: var(--color-accent); fill: var(--color-text)";

  const view = $derived(app.view);
  const outlines = $derived(
    app.selection
      .map((id) => selectionFrame(app.doc, [id]))
      .filter((f) => f !== null)
      .map((f) => frameOutline(f, view)),
  );
  const frame = $derived(
    app.toolId === "select" && app.selection.length > 0
      ? selectionFrame(app.doc, app.selection)
      : null,
  );
  const handles = $derived(frame ? handlePositions(frame, view) : null);
  const size = $derived(handleSize(app.lastPointerType));
  const marquee = $derived(app.overlay?.kind === "marquee" ? app.overlay.box : null);
  const marqueeA = $derived(marquee ? docToScreen(view, { x: marquee.x, y: marquee.y }) : null);
  const marqueeB = $derived(
    marquee ? docToScreen(view, { x: marquee.x + marquee.w, y: marquee.y + marquee.h }) : null,
  );

  const points = (ps: Vec[]) => ps.map((p) => `${p.x},${p.y}`).join(" ");
</script>

<g pointer-events="none">
  {#each outlines as outline, i (i)}
    <polygon points={points(outline)} style={LINE} stroke-width="1" />
  {/each}

  {#if frame && handles}
    {#if app.selection.length > 1}
      <polygon
        points={points(frameOutline(frame, view))}
        style={LINE}
        stroke-width="1"
        stroke-dasharray="4 3"
      />
    {/if}
    <line
      x1={handles.n.x}
      y1={handles.n.y}
      x2={handles.rotate.x}
      y2={handles.rotate.y}
      style={LINE}
      stroke-width="1"
    />
    <circle cx={handles.rotate.x} cy={handles.rotate.y} r={size / 2} style={KNOB} />
    {#each RESIZE_HANDLES as h (h)}
      <rect
        x={handles[h].x - size / 2}
        y={handles[h].y - size / 2}
        width={size}
        height={size}
        style={KNOB}
      />
    {/each}
  {/if}

  {#if marqueeA && marqueeB}
    <rect
      x={Math.min(marqueeA.x, marqueeB.x)}
      y={Math.min(marqueeA.y, marqueeB.y)}
      width={Math.abs(marqueeB.x - marqueeA.x)}
      height={Math.abs(marqueeB.y - marqueeA.y)}
      style="stroke: var(--color-accent); fill: var(--color-accent); fill-opacity: 0.08"
      stroke-dasharray="4 3"
    />
  {/if}
</g>
