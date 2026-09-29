<svelte:options namespace="svg" />

<script lang="ts">
  import { findNode } from "../doc/tree";
  import { cubicPoint, flattenSubpath } from "../geom/bezier";
  import { applyMat, multiply } from "../geom/mat";
  import type { Vec } from "../geom/vec";
  import { edgeCubic } from "../geom/warp";
  import { app, editCaretStops } from "../state/appState.svelte";
  import { docToScreen } from "../state/viewport";
  import { selectionRects } from "../text/edit";
  import { selectionFrame } from "../tools/frame";
  import { handleCorner } from "../tools/cage-handles";
  import { activeHandles, frameOutline, handlePositions, handleSize } from "../tools/gizmo";
  import { gradientHandles } from "../tools/gradient-handles";

  const LINE = "stroke: var(--color-accent); fill: none";
  const KNOB = "stroke: var(--color-accent); fill: var(--color-text)";
  const SELECTED_KNOB = "stroke: var(--color-accent); fill: var(--color-accent)";
  /** A contrast halo under every overlay mark (2026-09-28): the accent alone vanished on artwork of
   *  its own hue — a blue shape swallowed its gradient line, and a knob filled with that same blue
   *  disappeared. White under lines; a dark ring then a white one under knobs, so every mark reads
   *  on light, dark and accent-coloured artwork alike. Drawing only: hit-testing is unchanged. */
  const HALO_LIGHT = "stroke: #ffffff; stroke-opacity: 0.9; fill: none";
  const HALO_DARK = "stroke: #000000; stroke-opacity: 0.6; fill: none";
  type Mark =
    | { t: "line"; a: Vec; b: Vec }
    | { t: "poly"; pts: Vec[]; closed: boolean }
    | { t: "rect"; c: Vec; half: number }
    | { t: "circle"; c: Vec; r: number };

  const view = $derived(app.view);
  const brush = $derived(app.overlay?.kind === "brush" ? app.overlay : null);

  /** The character being tweaked (spec M10 §6). Derived from store state, exactly as the selection
   *  frame is — deliberately NOT put in the single `app.overlay` slot, which the marquee, the snap
   *  guides and the pen draft already share. */
  const charOutline = $derived.by(() => {
    if (app.toolId !== "text" || app.charSel === null) return null;
    const slot = app.charAt.indexOf(app.charSel);
    const quad = slot < 0 ? undefined : app.charQuads[slot];
    if (!quad) return null;
    const id = app.selection[0];
    const found = id === undefined ? null : findNode(app.doc, id);
    if (!found) return null;
    const world = multiply(found.parent, found.node.transform);
    return quad.map((q) => docToScreen(view, applyMat(world, q)));
  });
  /** The text edit's selection and caret (M22 §5), title-local through the title's world matrix,
   *  as polygons so a rotated or flipped title stays right. `editCaretStops` is the store's own
   *  guard: a stale title's stops are never drawn. */
  const MIN_SEL_PX = 4;
  /** A stable number per object identity: the caret's key changes whenever `textEdit` or the stops
   *  are replaced, so a Forward-Delete or an undo landing on the same index restarts the blink. */
  const seen = new WeakMap<object, number>();
  let seenCount = 0;
  const identity = (o: object) => {
    let n = seen.get(o);
    if (n === undefined) seen.set(o, (n = ++seenCount));
    return n;
  };
  const textCaret = $derived.by(() => {
    const edit = app.textEdit;
    const stops = editCaretStops();
    if (!edit || !stops) return null;
    const found = findNode(app.doc, edit.id);
    if (!found) return null;
    const world = multiply(found.parent, found.node.transform);
    const toScreen = (x: number, y: number) => docToScreen(view, applyMat(world, { x, y }));
    // A minimum width in title-local units, so an empty line's zero-width rect stays visible.
    const minLocal = MIN_SEL_PX / (view.zoom * (Math.hypot(world[0], world[1]) || 1));
    // The document trails the field during a burst, so the stops can be one keystroke short:
    // clamp, as `TextEditField.caretRect` does, rather than let the caret blink out.
    const last = stops.length - 1;
    const anchor = Math.min(edit.anchor, last);
    const focus = Math.min(edit.focus, last);
    const rects = selectionRects(stops, anchor, focus).map((r) => {
      const x1 = Math.max(r.x1, r.x0 + minLocal);
      return [
        toScreen(r.x0, r.top),
        toScreen(x1, r.top),
        toScreen(x1, r.bottom),
        toScreen(r.x0, r.bottom),
      ];
    });
    const stop = stops[focus];
    if (!stop) return null;
    // An emptied field still has the old text's stops; an empty run anchors at x = 0 for every
    // alignment, so the caret goes there rather than to the old text's first letter.
    const x = app.editEmpty ? 0 : stop.x;
    return {
      rects: app.editEmpty ? [] : rects,
      a: toScreen(x, stop.top),
      b: toScreen(x, stop.bottom),
      key: `${identity(edit)}:${identity(stops)}`,
    };
  });
  const outlines = $derived(
    app.selection
      // An emptied title is hidden (`NodeView`); its frame would outline text that is not there.
      .filter((id) => !(app.editEmpty && app.textEdit?.id === id))
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

  /** Spec M15 §7, M16 §6: the gradient lines, from the same function the tool hit-tests against.
   *  Each knob is filled with its stop's colour so start and end are told apart at a glance, and
   *  shaped by its role (spec M17 §6) so the rims and the centre are too. */
  const gradientView = $derived.by(() => {
    if (app.toolId !== "gradient") return [];
    return gradientHandles(app.doc, app.selection, app.gradientTarget).map((h) => {
      // review finding 7: `which` ties the pick to the paint it was made on, so switching
      // Fill/Stroke afterwards doesn't relabel it onto the wrong knob.
      const picked =
        app.gradientStop?.id === h.id && app.gradientStop.which === app.gradientTarget
          ? app.gradientStop.stop
          : null;
      if (h.kind === "linear") {
        return {
          kind: "linear" as const,
          a: docToScreen(view, h.from),
          b: docToScreen(view, h.to),
          mid: docToScreen(view, h.mid),
          midColor: h.midPaint.color,
          start: h.start.color,
          end: h.end.color,
          picked,
        };
      }
      // The end-stop ellipse's outline, sampled in document space (spec M16 §6).
      const rim: Vec[] = [];
      for (let i = 0; i < 64; i++) {
        const t = (i / 64) * Math.PI * 2;
        const ct = Math.cos(t),
          st = Math.sin(t);
        rim.push(
          docToScreen(view, {
            x: h.center.x + ct * (h.a.x - h.center.x) + st * (h.b.x - h.center.x),
            y: h.center.y + ct * (h.a.y - h.center.y) + st * (h.b.y - h.center.y),
          }),
        );
      }
      return {
        kind: "radial" as const,
        center: docToScreen(view, h.center),
        a: docToScreen(view, h.a),
        b: docToScreen(view, h.b),
        mid: docToScreen(view, h.mid),
        midColor: h.midPaint.color,
        rim,
        start: h.start.color,
        end: h.end.color,
        picked,
      };
    });
  });

  /** Spec M14 §5: the warp cage in screen space — four boundary curves sampled at 32 points, a
   *  leader from each handle to the corner it hangs from, the eight handles and the four corners. */
  const cage = $derived(app.overlay?.kind === "cage" ? app.overlay.cage : null);
  const cageView = $derived.by(() => {
    if (!cage) return null;
    const toScreen = (p: Vec) => docToScreen(view, p);
    const quad = [0, 1, 2, 3] as const;
    const edges = quad.map((i) => {
      const c = edgeCubic(cage, i);
      return Array.from({ length: 32 }, (_, k) => toScreen(cubicPoint(c, k / 31)));
    });
    const handles = quad.flatMap((i) =>
      ([0, 1] as const).map((j) => ({
        a: toScreen(handleCorner(cage, i, j)),
        b: toScreen(cage.edges[i][j]),
      })),
    );
    return { edges, handles, corners: cage.corners.map(toScreen) };
  });

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

{#snippet mark(m: Mark, style: string, width: number, dash?: string)}
  {#if m.t === "line"}
    <line
      x1={m.a.x}
      y1={m.a.y}
      x2={m.b.x}
      y2={m.b.y}
      {style}
      stroke-width={width}
      stroke-dasharray={dash}
    />
  {:else if m.t === "poly" && m.closed}
    <polygon points={points(m.pts)} {style} stroke-width={width} stroke-dasharray={dash} />
  {:else if m.t === "poly"}
    <polyline points={points(m.pts)} {style} stroke-width={width} stroke-dasharray={dash} />
  {:else if m.t === "rect"}
    <rect
      x={m.c.x - m.half}
      y={m.c.y - m.half}
      width={m.half * 2}
      height={m.half * 2}
      {style}
      stroke-width={width}
    />
  {:else}
    <circle cx={m.c.x} cy={m.c.y} r={m.r} {style} stroke-width={width} />
  {/if}
{/snippet}

<!-- A line's halo: white, 3px, under the 1px mark — dashed when the mark is. -->
{#snippet lineHalo(m: Mark, dash?: string)}
  {@render mark(m, HALO_LIGHT, 3, dash)}
{/snippet}

<!-- A knob's halo: a dark ring outside a white one, both outside the knob's own `width` outline.
     Drawn before the knob, whose fill covers the halo's inner half. -->
{#snippet knobHalo(m: Mark, width: number = 1)}
  {@render mark(m, HALO_DARK, width + 4)}
  {@render mark(m, HALO_LIGHT, width + 2)}
{/snippet}

<g pointer-events="none">
  {#each app.brushPending as p, i (i)}
    <polygon
      points={points(p.outline.map((v) => docToScreen(view, v)))}
      style="fill: {p.fill.color}; fill-opacity: {p.fill.opacity * p.opacity}; stroke: none"
    />
  {/each}
  {#if brush}
    {#if brush.live}
      <polygon
        points={points(brush.live.map((v) => docToScreen(view, v)))}
        style="fill: {brush.fill.color}; fill-opacity: {brush.fill.opacity *
          brush.opacity}; stroke: none"
      />
    {/if}
    {#if brush.cursor}
      {@const c = {
        t: "circle" as const,
        c: docToScreen(view, brush.cursor.at),
        r: Math.max(brush.cursor.r * view.zoom, 1),
      }}
      {@render mark(c, HALO_LIGHT, 3)}
      {@render mark(c, LINE, 1)}
    {/if}
  {/if}
  {#if enteredOutline}
    {@render lineHalo({ t: "poly", pts: enteredOutline, closed: true }, "4 3")}
    <polygon
      points={points(enteredOutline)}
      style="stroke: var(--color-line); fill: none"
      stroke-width="1"
      stroke-dasharray="4 3"
    />
  {/if}
  {#each outlines as outline, i (i)}
    {@render lineHalo({ t: "poly", pts: outline, closed: true })}
    <polygon points={points(outline)} style={LINE} stroke-width="1" />
  {/each}

  {#if frame && handles}
    {#if app.selection.length > 1}
      {@render lineHalo({ t: "poly", pts: frameOutline(frame, view), closed: true }, "4 3")}
      <polygon
        points={points(frameOutline(frame, view))}
        style={LINE}
        stroke-width="1"
        stroke-dasharray="4 3"
      />
    {/if}
    {@render lineHalo({ t: "line", a: handles.n, b: handles.rotate })}
    <line
      x1={handles.n.x}
      y1={handles.n.y}
      x2={handles.rotate.x}
      y2={handles.rotate.y}
      style={LINE}
      stroke-width="1"
    />
    {@render knobHalo({ t: "circle", c: handles.rotate, r: size / 2 })}
    <circle cx={handles.rotate.x} cy={handles.rotate.y} r={size / 2} style={KNOB} />
    {#each activeHandles(frame) as h (h)}
      {@render knobHalo({ t: "rect", c: handles[h], half: size / 2 })}
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
      {@render lineHalo({ t: "poly", pts: outline, closed: false })}
      <polyline points={points(outline)} style={LINE} stroke-width="1" />
    {/each}
    {#each nodeView.handles as h, i (i)}
      {@render lineHalo({ t: "line", a: h.a, b: h.b })}
      <line x1={h.a.x} y1={h.a.y} x2={h.b.x} y2={h.b.y} style={LINE} stroke-width="1" />
      {@render knobHalo({ t: "circle", c: h.b, r: knobSize / 2 - 1 })}
      <circle cx={h.b.x} cy={h.b.y} r={knobSize / 2 - 1} style={KNOB} stroke-width="1" />
    {/each}
    {#each nodeView.knobs as k, i (i)}
      {@render knobHalo({ t: "rect", c: k.p, half: knobSize / 2 })}
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

  {#each gradientView as g, i (i)}
    {@const r = knobSize / 2 + 1}
    {@const w = (on: boolean) => (on ? 3 : 1.5)}
    {@const dm = r * 0.85}
    {@const diamond = [
      { x: g.mid.x, y: g.mid.y - dm },
      { x: g.mid.x + dm, y: g.mid.y },
      { x: g.mid.x, y: g.mid.y + dm },
      { x: g.mid.x - dm, y: g.mid.y },
    ]}
    {#if g.kind === "linear"}
      {@render lineHalo({ t: "line", a: g.a, b: g.b })}
      <line x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} style={LINE} stroke-width="1" />
    {:else}
      {@render lineHalo({ t: "line", a: g.center, b: g.a })}
      {@render lineHalo({ t: "line", a: g.center, b: g.b })}
      {@render lineHalo({ t: "poly", pts: g.rim, closed: true }, "4 3")}
      <line x1={g.center.x} y1={g.center.y} x2={g.a.x} y2={g.a.y} style={LINE} stroke-width="1" />
      <line x1={g.center.x} y1={g.center.y} x2={g.b.x} y2={g.b.y} style={LINE} stroke-width="1" />
      <polygon points={points(g.rim)} style={LINE} stroke-width="1" stroke-dasharray="4 3" />
    {/if}
    <!-- Spec M17 §6: the midpoint diamond, filled with the effective middle colour it stands for
         (custom, or the 50/50 mix when Auto). Below the knobs, as `pickHandle` ranks it below
         them. -->
    {@render knobHalo({ t: "poly", pts: diamond, closed: true }, w(g.picked === "mid"))}
    <polygon
      points={points(diamond)}
      style="stroke: var(--color-accent); fill: {g.midColor}"
      stroke-width={w(g.picked === "mid")}
    />
    {#if g.kind === "linear"}
      <!-- Drawn end, then start (review finding 2): `pickHandle`'s tie order is start, end, so
           drawing in reverse puts the tie's winner, start, on top. Spec M17 §6: end is a square,
           start a circle. -->
      {@render knobHalo({ t: "rect", c: g.b, half: r }, w(g.picked === "end"))}
      <rect
        x={g.b.x - r}
        y={g.b.y - r}
        width={r * 2}
        height={r * 2}
        style="stroke: var(--color-accent); fill: {g.end}"
        stroke-width={w(g.picked === "end")}
      />
      {@render knobHalo({ t: "circle", c: g.a, r }, w(g.picked === "start"))}
      <circle
        cx={g.a.x}
        cy={g.a.y}
        {r}
        style="stroke: var(--color-accent); fill: {g.start}"
        stroke-width={w(g.picked === "start")}
      />
    {:else}
      <!-- Drawn B, then A, then centre (review finding 2): `pickHandle`'s tie order is centre, A,
           B. Spec M17 §6: B (rotate/scale) is a ring in the end colour over the accent, A
           (stretch) a square, the centre a circle. -->
      {@render knobHalo({ t: "circle", c: g.b, r }, w(g.picked === "end") + 2.5)}
      <circle
        cx={g.b.x}
        cy={g.b.y}
        {r}
        style="stroke: var(--color-accent); fill: none"
        stroke-width={w(g.picked === "end") + 2.5}
      />
      <circle cx={g.b.x} cy={g.b.y} {r} style="stroke: {g.end}; fill: none" stroke-width="2" />
      {@render knobHalo({ t: "rect", c: g.a, half: r }, w(g.picked === "end"))}
      <rect
        x={g.a.x - r}
        y={g.a.y - r}
        width={r * 2}
        height={r * 2}
        style="stroke: var(--color-accent); fill: {g.end}"
        stroke-width={w(g.picked === "end")}
      />
      {@render knobHalo({ t: "circle", c: g.center, r }, w(g.picked === "start"))}
      <circle
        cx={g.center.x}
        cy={g.center.y}
        {r}
        style="stroke: var(--color-accent); fill: {g.start}"
        stroke-width={w(g.picked === "start")}
      />
    {/if}
  {/each}

  {#if cageView}
    {#each cageView.edges as poly, i (i)}
      {@render lineHalo({ t: "poly", pts: poly, closed: false })}
      <polyline points={points(poly)} style={LINE} stroke-width="1" />
    {/each}
    {#each cageView.handles as h, i (i)}
      {@render lineHalo({ t: "line", a: h.a, b: h.b })}
      <line x1={h.a.x} y1={h.a.y} x2={h.b.x} y2={h.b.y} style={LINE} stroke-width="1" />
    {/each}
    {#each cageView.handles as h, i (i)}
      {@render knobHalo({ t: "circle", c: h.b, r: knobSize / 2 - 1 })}
      <circle cx={h.b.x} cy={h.b.y} r={knobSize / 2 - 1} style={KNOB} stroke-width="1" />
    {/each}
    <!-- Corners last: they draw on top, as `pickCage` ranks them first. -->
    {#each cageView.corners as c, i (i)}
      {@render knobHalo({ t: "rect", c, half: knobSize / 2 })}
      <rect
        x={c.x - knobSize / 2}
        y={c.y - knobSize / 2}
        width={knobSize}
        height={knobSize}
        style={SELECTED_KNOB}
        stroke-width="1"
      />
    {/each}
  {/if}

  {#if penView}
    {#each penView.outline as poly, i (i)}
      {@render lineHalo({ t: "poly", pts: poly, closed: false })}
      <polyline points={points(poly)} style={LINE} stroke-width="1" />
    {/each}
    {#if penView.rubber}
      {@render lineHalo({ t: "line", a: penView.rubber.a, b: penView.rubber.b }, "4 3")}
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
      {@render lineHalo({ t: "line", a: h.a, b: h.b })}
      <line x1={h.a.x} y1={h.a.y} x2={h.b.x} y2={h.b.y} style={LINE} stroke-width="1" />
      {@render knobHalo({ t: "circle", c: h.b, r: knobSize / 2 - 1 })}
      <circle cx={h.b.x} cy={h.b.y} r={knobSize / 2 - 1} style={KNOB} stroke-width="1" />
    {/each}
    {#each penView.knobs as k, i (i)}
      {@render knobHalo({ t: "rect", c: k, half: knobSize / 2 })}
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
    {@const x0 = Math.min(marqueeA.x, marqueeB.x)}
    {@const y0 = Math.min(marqueeA.y, marqueeB.y)}
    {@const x1 = Math.max(marqueeA.x, marqueeB.x)}
    {@const y1 = Math.max(marqueeA.y, marqueeB.y)}
    {@render lineHalo(
      {
        t: "poly",
        pts: [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
        ],
        closed: true,
      },
      "4 3",
    )}
    <rect
      x={x0}
      y={y0}
      width={x1 - x0}
      height={y1 - y0}
      style="stroke: var(--color-accent); fill: var(--color-accent); fill-opacity: 0.08"
      stroke-dasharray="4 3"
    />
  {/if}

  {#if guides}
    {#each guides.xs as x, i (i)}
      {@const sx = docToScreen(view, { x, y: 0 }).x}
      {@render lineHalo({ t: "line", a: { x: sx, y: 0 }, b: { x: sx, y: app.viewportSize.h } })}
      <line x1={sx} y1="0" x2={sx} y2={app.viewportSize.h} style={GUIDE} stroke-width="1" />
    {/each}
    {#each guides.ys as y, i (i)}
      {@const sy = docToScreen(view, { x: 0, y }).y}
      {@render lineHalo({ t: "line", a: { x: 0, y: sy }, b: { x: app.viewportSize.w, y: sy } })}
      <line x1="0" y1={sy} x2={app.viewportSize.w} y2={sy} style={GUIDE} stroke-width="1" />
    {/each}
  {/if}

  {#if textCaret}
    {#each textCaret.rects as r, i (i)}
      {@render mark({ t: "poly", pts: r, closed: true }, HALO_LIGHT, 1)}
      <polygon
        points={points(r)}
        style="stroke: none; fill: var(--color-accent); fill-opacity: 0.25"
      />
    {/each}
    {#key textCaret.key}
      <g class="text-caret">
        {@render lineHalo({ t: "line", a: textCaret.a, b: textCaret.b })}
        <line
          x1={textCaret.a.x}
          y1={textCaret.a.y}
          x2={textCaret.b.x}
          y2={textCaret.b.y}
          style={LINE}
          stroke-width="1.5"
        />
      </g>
    {/key}
  {/if}

  {#if charOutline}
    {@render lineHalo({ t: "poly", pts: charOutline, closed: true })}
    <polygon
      points={charOutline.map((p) => `${p.x},${p.y}`).join(" ")}
      style="stroke: var(--color-accent); fill: var(--color-accent); fill-opacity: 0.18"
      stroke-width="1.5"
    />
  {/if}
</g>
