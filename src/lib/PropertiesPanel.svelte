<script lang="ts">
  import { DEFAULT_STYLE, type LineCap, type LineJoin, type Paint } from "../doc/document";
  import type { PaintSlot } from "../doc/paint-edit";
  import { gradientHandles } from "../tools/gradient-handles";
  import {
    app,
    beginUiGesture,
    endDocGesture,
    applyGeometry,
    moveSelectedNodes,
    setGradientTarget,
    setGradientType,
    setPolygonPrefs,
    setSelectedNodeType,
    setSelectionGradientMid,
    setSelectionGradientMidAuto,
    setSelectionGradientStop,
    setSelectionOpacity,
    setSelectionPaintKind,
    setSelectionPolygon,
    setSelectionRectRadius,
    setSelectionStyle,
  } from "../state/appState.svelte";
  import {
    gradientTypeShown,
    selectedNodeSummary,
    selectionGeometry,
    selectionOpacity,
    selectionStyles,
    summarizeGradient,
    summarizePolygons,
    summarizeRects,
    summarizeStyles,
    type Field,
    type GeometryField,
  } from "../state/properties";
  import NumberField from "./NumberField.svelte";
  import PanelHeader from "./PanelHeader.svelte";
  import TextPanel from "./TextPanel.svelte";
  import { selectedTitle } from "../state/appState.svelte";
  import FieldSection from "./FieldSection.svelte";
  import PaintField from "./PaintField.svelte";
  import ToggleButton from "./ToggleButton.svelte";

  // The default style always has both paints.
  const FILL_FALLBACK: Paint = DEFAULT_STYLE.fill!;
  const STROKE_FALLBACK: Paint = DEFAULT_STYLE.stroke!;
  const GEOMETRY: { field: GeometryField; label: string; min?: number; suffix?: string }[] = [
    { field: "x", label: "X" },
    { field: "y", label: "Y" },
    { field: "w", label: "W", min: 0.01 },
    { field: "h", label: "H", min: 0.01 },
    { field: "r", label: "R", suffix: "°" },
  ];
  const NODE_TYPES = [
    { type: "corner" as const, label: "Corner" },
    { type: "smooth" as const, label: "Smooth" },
    { type: "symmetric" as const, label: "Symmetric" },
  ];
  const nodeSummary = $derived(
    app.toolId === "node" && selectedNodeSummary(app.doc, app.nodeTarget, app.nodeSel),
  );

  const hasSelection = $derived(app.selection.length > 0);
  const opacity = $derived(selectionOpacity(app.doc, app.selection));
  const opacityValue = $derived.by(() => {
    const field = opacity ?? summary?.opacity;
    if (!field) return null;
    return field.mixed ? null : Math.round(field.value * 100);
  });
  const summary = $derived(
    summarizeStyles(hasSelection ? selectionStyles(app.doc, app.selection) : [app.prefs.style]),
  );
  const fillGrad = $derived(
    hasSelection ? summarizeGradient(selectionStyles(app.doc, app.selection), "fill") : null,
  );
  const strokeGrad = $derived(
    hasSelection ? summarizeGradient(selectionStyles(app.doc, app.selection), "stroke") : null,
  );
  /** Spec M16 §5: the Type row's value — the selection's gradient kind on the edited paint,
   *  falling back to the kind the tool draws next when nothing selected has a gradient. */
  const gradientType = $derived(
    gradientTypeShown(
      hasSelection ? selectionStyles(app.doc, app.selection) : [],
      app.gradientTarget,
      app.gradientType,
    ),
  );
  const geometry = $derived(hasSelection ? selectionGeometry(app.doc, app.selection) : null);
  const rects = $derived(hasSelection ? summarizeRects(app.doc, app.selection) : null);
  const polygons = $derived(hasSelection ? summarizePolygons(app.doc, app.selection) : null);
  const poly = $derived(app.prefs.polygon);
  /** Spec M10 §6: the Text section appears for a single selected title. */
  const title = $derived(selectedTitle());
  /** Review finding 7: which stop's row is highlighted, for the given paint slot only — gated on
   *  `which` (recorded when the pick was made), not the currently active Edit target, so switching
   *  Fill/Stroke afterwards doesn't relabel the pick onto the other row. Reachability is checked
   *  against `gradientHandles`, not raw `app.selection`, so a stop picked on a shape reached
   *  through a selected group still highlights its row. */
  const pickedStop = (which: PaintSlot) => {
    const gs = app.gradientStop;
    if (!gs || gs.which !== which) return null;
    return gradientHandles(app.doc, app.selection, which).some((h) => h.id === gs.id)
      ? gs.stop
      : null;
  };
  const value = <T,>(f: Field<T>): T | null => (f.mixed ? null : f.value);

  let { expanded, ontoggle, flex }: { expanded: boolean; ontoggle: () => void; flex: string } =
    $props();
</script>

<!-- `@container`: the field grid pairs rows two-up once THIS panel is wide enough (see
     `.field-grid`). The trigger has to be the sidebar's own width, not the viewport's — the sidebar
     is dragged to any width independently of the window — which is exactly what a container query
     does and a media query cannot. -->
<section class="@container flex min-h-0 flex-col" style:flex aria-label="Properties">
  <PanelHeader
    title="Properties"
    open={expanded}
    {ontoggle}
    showTitle="Show the properties"
    hideTitle="Hide the properties"
  />
  {#if expanded}
    <div
      class="field-grid min-h-0 flex-1 content-start overflow-y-auto overscroll-contain p-3 text-xs"
    >
      <h2 class="section-title field-full">
        {hasSelection ? "Selection" : "Defaults for new shapes"}
      </h2>

      {#if app.toolId === "gradient"}
        <!-- Spec M15 §6: first, not last — picking the Gradient tool switches this panel's job to
             choosing which paint it edits, and the panel scrolls. Below the Fill/Stroke/Shape/Node
             sections, this switch could sit off-screen exactly when the tool just became active
             (the controller's browser check after Task 6 caught it there). As the Node section
             appears only for the node tool, this appears only for the Gradient tool. -->
        <FieldSection id="gradient" title="Gradient">
          <div class="field-row">
            <span class="text-muted">Edit</span>
            <div class="flex gap-1">
              <ToggleButton
                label="Fill"
                value={app.gradientTarget === "fill"}
                onchange={() => setGradientTarget("fill")}
              />
              <ToggleButton
                label="Stroke"
                value={app.gradientTarget === "stroke"}
                onchange={() => setGradientTarget("stroke")}
              />
            </div>
          </div>
          <div
            class="field-row"
            title="Kind of gradient the tool draws — converts the selection's gradients"
          >
            <span class="text-muted">Type</span>
            <div class="flex gap-1">
              <ToggleButton
                label="Linear"
                value={gradientType.mixed ? "mixed" : gradientType.value === "linear"}
                onchange={() => setGradientType("linear")}
              />
              <ToggleButton
                label="Radial"
                value={gradientType.mixed ? "mixed" : gradientType.value === "radial"}
                onchange={() => setGradientType("radial")}
              />
            </div>
          </div>
        </FieldSection>
      {/if}

      <!-- Spec M10 §6: first, not last. Placing a title is immediately followed by typing it, and
           this panel scrolls — below the paint and geometry sections it sat under the fold. -->
      {#if title}
        <TextPanel {title} />
      {/if}

      {#if summary}
        <div class="field-full">
          <PaintField
            label="Fill"
            field={summary.fill}
            present={summary.fillOn}
            fallback={app.prefs.style.fill ?? FILL_FALLBACK}
            kind={fillGrad?.kind ?? null}
            stops={fillGrad?.stops ?? null}
            picked={pickedStop("fill")}
            mid={fillGrad?.mid ?? null}
            midAuto={fillGrad?.midAuto ?? null}
            midPaint={fillGrad?.midPaint ?? null}
            onchange={(p) => setSelectionStyle({ fill: p })}
            onkind={(k) => setSelectionPaintKind("fill", k)}
            onstop={(stop, p) => setSelectionGradientStop("fill", stop, p)}
            onmid={(m) => setSelectionGradientMid("fill", m)}
            onmidauto={(a) => setSelectionGradientMidAuto("fill", a)}
            onlivestart={beginUiGesture}
            onliveend={endDocGesture}
          />
        </div>
        <div class="field-full">
          <PaintField
            label="Stroke"
            field={summary.stroke}
            present={summary.strokeOn}
            fallback={app.prefs.style.stroke ?? STROKE_FALLBACK}
            kind={strokeGrad?.kind ?? null}
            stops={strokeGrad?.stops ?? null}
            picked={pickedStop("stroke")}
            mid={strokeGrad?.mid ?? null}
            midAuto={strokeGrad?.midAuto ?? null}
            midPaint={strokeGrad?.midPaint ?? null}
            onchange={(p) => setSelectionStyle({ stroke: p })}
            onkind={(k) => setSelectionPaintKind("stroke", k)}
            onstop={(stop, p) => setSelectionGradientStop("stroke", stop, p)}
            onmid={(m) => setSelectionGradientMid("stroke", m)}
            onmidauto={(a) => setSelectionGradientMidAuto("stroke", a)}
            onlivestart={beginUiGesture}
            onliveend={endDocGesture}
          />
        </div>
        <NumberField
          onlivestart={beginUiGesture}
          onliveend={endDocGesture}
          label="Width"
          step={0.5}
          value={value(summary.strokeWidth)}
          min={0}
          max={1000}
          onchange={(v) => setSelectionStyle({ strokeWidth: v })}
        />
        <label class="field-row">
          <span class="text-muted">Cap</span>
          <select
            class="field w-full min-w-0"
            value={value(summary.cap) ?? ""}
            onchange={(e) => setSelectionStyle({ cap: e.currentTarget.value as LineCap })}
          >
            <option value="" disabled>mixed</option>
            <option value="butt">butt</option>
            <option value="round">round</option>
            <option value="square">square</option>
          </select>
        </label>
        <label class="field-row">
          <span class="text-muted">Join</span>
          <select
            class="field w-full min-w-0"
            value={value(summary.join) ?? ""}
            onchange={(e) => setSelectionStyle({ join: e.currentTarget.value as LineJoin })}
          >
            <option value="" disabled>mixed</option>
            <option value="miter">miter</option>
            <option value="round">round</option>
            <option value="bevel">bevel</option>
          </select>
        </label>
        <NumberField
          onlivestart={beginUiGesture}
          onliveend={endDocGesture}
          label="Opacity"
          value={opacityValue}
          min={0}
          max={100}
          suffix="%"
          onchange={(v) => setSelectionOpacity(v / 100)}
        />
      {/if}

      {#if rects || polygons}
        <FieldSection id="shape" title="Shape">
          {#if rects}
            <NumberField
              onlivestart={beginUiGesture}
              onliveend={endDocGesture}
              label="Radius"
              value={rects.radius}
              min={0}
              onchange={setSelectionRectRadius}
            />
          {/if}
          {#if polygons}
            <NumberField
              onlivestart={beginUiGesture}
              onliveend={endDocGesture}
              label="Sides"
              value={polygons.sides}
              min={3}
              max={32}
              onchange={(v) => setSelectionPolygon({ sides: Math.round(v) })}
            />
            <div class="field-full">
              <ToggleButton
                label="Star"
                value={polygons.star}
                onchange={(star) => setSelectionPolygon({ star })}
              />
            </div>
            {#if polygons.anyStar}
              <NumberField
                onlivestart={beginUiGesture}
                onliveend={endDocGesture}
                label="Inner"
                value={polygons.innerRatio === null ? null : Math.round(polygons.innerRatio * 100)}
                min={10}
                max={95}
                suffix="%"
                onchange={(v) => setSelectionPolygon({ innerRatio: v / 100 })}
              />
            {/if}
          {/if}
        </FieldSection>
      {/if}

      {#if !hasSelection || app.toolId === "polygon"}
        <FieldSection id="newPolygons" title="New polygons">
          <NumberField
            onlivestart={beginUiGesture}
            onliveend={endDocGesture}
            label="Sides"
            value={poly.sides}
            min={3}
            max={32}
            onchange={(v) => setPolygonPrefs({ sides: Math.round(v) })}
          />
          <div class="field-full">
            <ToggleButton
              label="Star"
              value={poly.star}
              onchange={(star) => setPolygonPrefs({ star })}
            />
          </div>
          {#if poly.star}
            <NumberField
              onlivestart={beginUiGesture}
              onliveend={endDocGesture}
              label="Inner"
              value={Math.round(poly.innerRatio * 100)}
              min={10}
              max={95}
              suffix="%"
              onchange={(v) => setPolygonPrefs({ innerRatio: v / 100 })}
            />
          {/if}
        </FieldSection>
      {/if}

      {#if nodeSummary}
        <FieldSection id="node" title="Node">
          <div class="field-full flex gap-1">
            {#each NODE_TYPES as t (t.type)}
              <ToggleButton
                value={nodeSummary.type === "mixed" ? "mixed" : nodeSummary.type === t.type}
                label={t.label}
                onchange={() => setSelectedNodeType(t.type)}
              />
            {/each}
          </div>
          {#if nodeSummary.point}
            {@const pt = nodeSummary.point}
            <NumberField
              onlivestart={beginUiGesture}
              onliveend={endDocGesture}
              label="X"
              value={pt.x}
              onchange={(v) => moveSelectedNodes(v - pt.x, 0)}
            />
            <NumberField
              onlivestart={beginUiGesture}
              onliveend={endDocGesture}
              label="Y"
              value={pt.y}
              onchange={(v) => moveSelectedNodes(0, v - pt.y)}
            />
          {/if}
        </FieldSection>
      {/if}

      {#if geometry}
        <FieldSection id="geometry" title="Geometry">
          {#each GEOMETRY as g (g.field)}
            <NumberField
              onlivestart={beginUiGesture}
              onliveend={endDocGesture}
              label={g.label}
              value={geometry[g.field]}
              min={g.min}
              suffix={g.suffix}
              onchange={(v) => applyGeometry(g.field, v)}
            />
          {/each}
        </FieldSection>
      {/if}
    </div>
  {/if}
</section>
