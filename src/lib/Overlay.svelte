<svelte:options namespace="svg" />

<script lang="ts">
  import { findNode } from "../doc/tree";
  import { flattenSubpath } from "../geom/bezier";
  import { applyMat, multiply } from "../geom/mat";
  import type { Vec } from "../geom/vec";
  import { app } from "../state/appState.svelte";
  import { docToScreen } from "../state/viewport";
  import { selectionFrame } from "../tools/frame";
  import { activeHandles, frameOutline, handlePositions, handleSize } from "../tools/gizmo";

  const LINE = "stroke: var(--color-accent); fill: none";
  const KNOB = "stroke: var(--color-accent); fill: var(--color-text)";
  const SELECTED_KNOB = "stroke: var(--color-accent); fill: var(--color-accent)";

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
  const entered = $derived(
    app.enteredGroupId === null ? null : selectionFrame(app.doc, [app.enteredGroupId]),
  );
  const enteredOutline = $derived(entered ? frameOutline(entered, view) : null);
  const size = $derived(handleSize(app.lastPointerType));
  const handles = $derived(frame ? handlePositions(frame, view, size) : null);
  const marquee = $derived(app.overlay?.kind === "marquee" ? app.overlay.box : null);
  const marqueeA = $derived(marquee ? docToScreen(view, { x: marquee.x, y: marquee.y }) : null);
  const marqueeB = $derived(
    marquee ? docToScreen(view, { x: marquee.x + marquee.w, y: marquee.y + marquee.h }) : null,
  );
  const guides = $derived(app.overlay?.kind === "guides" ? app.overlay : null);
  const GUIDE = "stroke: var(--color-guide)";

  const nodeView = $derived.by(() => {
    if (app.toolId !== "node" || app.nodeTarget === null) return null;
    const found = findNode(app.doc, app.nodeTarget);
    if (!found || found.node.kind !== "path") return null;
    const world = multiply(found.parent, found.node.transform);
    const toScreen = (p: Vec) => docToScreen(view, applyMat(world, p));
    const worldScale = Math.sqrt(Math.abs(world[0] * world[3] - world[1] * world[2])) * view.zoom;
    const scale = Number.isFinite(worldScale) && worldScale > 0 ? worldScale : 1;
    const selected = new Set(app.nodeSel.map((r) => `${r.sub}:${r.i}`));
    const knobs: { p: Vec; on: boolean }[] = [];
    const handles: { a: Vec; b: Vec }[] = [];
    const outlines: Vec[][] = [];
    found.node.subpaths.forEach((sp, sub) => {
      outlines.push(flattenSubpath(sp, scale).map(toScreen));
      sp.nodes.forEach((n, i) => {
        const on = selected.has(`${sub}:${i}`);
        knobs.push({ p: toScreen(n.p), on });
        if (!on) return;
        if (n.in) handles.push({ a: toScreen(n.p), b: toScreen(n.in) });
        if (n.out) handles.push({ a: toScreen(n.p), b: toScreen(n.out) });
      });
    });
    return { knobs, handles, outlines };
  });
  const knobSize = $derived(handleSize(app.lastPointerType) - 1);

  const points = (ps: Vec[]) => ps.map((p) => `${p.x},${p.y}`).join(" ");

  const pen = $derived(app.overlay?.kind === "pen" ? app.overlay : null);
  const penView = $derived.by(() => {
    if (!pen) return null;
    const toScreen = (p: Vec) => docToScreen(view, p);
    return {
      outline: pen.outline.map((poly) => poly.map(toScreen)),
      knobs: pen.knobs.map(toScreen),
      handles: pen.handles.map((h) => ({ a: toScreen(h.a), b: toScreen(h.b) })),
      rubber: pen.rubber ? { a: toScreen(pen.rubber.a), b: toScreen(pen.rubber.b) } : null,
      closeHint: pen.closeHint,
    };
  });
</script>

<g pointer-events="none">
  {#if enteredOutline}
    <polygon
      points={points(enteredOutline)}
      style="stroke: var(--color-line); fill: none"
      stroke-width="1"
      stroke-dasharray="4 3"
    />
  {/if}
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
    {#each activeHandles(frame) as h (h)}
      <rect
        x={handles[h].x - size / 2}
        y={handles[h].y - size / 2}
        width={size}
        height={size}
        style={KNOB}
      />
    {/each}
  {/if}

  {#if nodeView}
    {#each nodeView.outlines as outline, i (i)}
      <polyline points={points(outline)} style={LINE} stroke-width="1" />
    {/each}
    {#each nodeView.handles as h, i (i)}
      <line x1={h.a.x} y1={h.a.y} x2={h.b.x} y2={h.b.y} style={LINE} stroke-width="1" />
      <circle cx={h.b.x} cy={h.b.y} r={knobSize / 2 - 1} style={KNOB} stroke-width="1" />
    {/each}
    {#each nodeView.knobs as k, i (i)}
      <rect
        x={k.p.x - knobSize / 2}
        y={k.p.y - knobSize / 2}
        width={knobSize}
        height={knobSize}
        style={k.on ? SELECTED_KNOB : KNOB}
        stroke-width="1"
      />
    {/each}
  {/if}

  {#if penView}
    {#each penView.outline as poly, i (i)}
      <polyline points={points(poly)} style={LINE} stroke-width="1" />
    {/each}
    {#if penView.rubber}
      <line
        x1={penView.rubber.a.x}
        y1={penView.rubber.a.y}
        x2={penView.rubber.b.x}
        y2={penView.rubber.b.y}
        style={LINE}
        stroke-width="1"
        stroke-dasharray="4 3"
      />
    {/if}
    {#each penView.handles as h, i (i)}
      <line x1={h.a.x} y1={h.a.y} x2={h.b.x} y2={h.b.y} style={LINE} stroke-width="1" />
      <circle cx={h.b.x} cy={h.b.y} r={knobSize / 2 - 1} style={KNOB} stroke-width="1" />
    {/each}
    {#each penView.knobs as k, i (i)}
      <rect
        x={k.x - knobSize / 2}
        y={k.y - knobSize / 2}
        width={knobSize}
        height={knobSize}
        style={i === 0 && penView.closeHint ? SELECTED_KNOB : KNOB}
        stroke-width="1"
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

  {#if guides}
    {#each guides.xs as x, i (i)}
      {@const sx = docToScreen(view, { x, y: 0 }).x}
      <line x1={sx} y1="0" x2={sx} y2={app.viewportSize.h} style={GUIDE} stroke-width="1" />
    {/each}
    {#each guides.ys as y, i (i)}
      {@const sy = docToScreen(view, { x: 0, y }).y}
      <line x1="0" y1={sy} x2={app.viewportSize.w} y2={sy} style={GUIDE} stroke-width="1" />
    {/each}
  {/if}
</g>
