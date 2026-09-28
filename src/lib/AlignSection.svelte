<script lang="ts">
  import {
    AlignCenterHorizontal,
    AlignCenterVertical,
    AlignEndHorizontal,
    AlignEndVertical,
    AlignHorizontalSpaceBetween,
    AlignStartHorizontal,
    AlignStartVertical,
    AlignVerticalSpaceBetween,
  } from "@lucide/svelte";
  import { alignTargetCount, type AlignOp, type DistributeAxis } from "../doc/align";
  import { alignSelection, app, distributeSelection } from "../state/appState.svelte";
  import FieldSection from "./FieldSection.svelte";

  /** Align and distribute (spec M19 §3). Shown whenever something is selected. Several objects
   *  align to the selection's bounds, a single one to the artboard — and each title (also the
   *  status-bar hint, invariant 24) says which will happen. */
  // What the commands will act on, not the raw selection: a group and its own child count once, and
  // an object with nothing drawable not at all — so the hints match what happens.
  const count = $derived(alignTargetCount(app.doc, app.selection));

  const ALIGNS: { op: AlignOp; icon: typeof AlignStartVertical; edge: string; name: string }[] = [
    { op: "left", icon: AlignStartVertical, edge: "left edges", name: "left" },
    { op: "hcenter", icon: AlignCenterVertical, edge: "horizontal centres", name: "centre" },
    { op: "right", icon: AlignEndVertical, edge: "right edges", name: "right" },
    { op: "top", icon: AlignStartHorizontal, edge: "top edges", name: "top" },
    { op: "vcenter", icon: AlignCenterHorizontal, edge: "vertical centres", name: "middle" },
    { op: "bottom", icon: AlignEndHorizontal, edge: "bottom edges", name: "bottom" },
  ];
  const DISTRIBUTES: {
    axis: DistributeAxis;
    icon: typeof AlignStartVertical;
    label: string;
  }[] = [
    { axis: "h", icon: AlignHorizontalSpaceBetween, label: "Distribute horizontally" },
    { axis: "v", icon: AlignVerticalSpaceBetween, label: "Distribute vertically" },
  ];

  const alignTitle = (a: (typeof ALIGNS)[number]) =>
    count === 1 ? `Align ${a.name} to the artboard` : `Align ${a.edge}`;
</script>

<FieldSection id="align" title="Align">
  <div class="field-full flex items-center gap-1">
    {#each ALIGNS as a (a.op)}
      <button
        type="button"
        class="btn flex-1 justify-center px-0"
        aria-label={alignTitle(a)}
        title={alignTitle(a)}
        onclick={() => alignSelection(a.op)}
      >
        <a.icon size={16} />
      </button>
    {/each}
  </div>
  <div class="field-full flex items-center gap-1">
    {#each DISTRIBUTES as d (d.axis)}
      <button
        type="button"
        class={[
          "btn flex-1 justify-center gap-1.5",
          count < 3 && "cursor-default text-disabled hover:border-line",
        ]}
        aria-disabled={count < 3}
        title={count < 3 ? `${d.label} — select three or more objects` : `${d.label} — equal gaps`}
        onclick={() => count >= 3 && distributeSelection(d.axis)}
      >
        <d.icon size={16} />
        <span>{d.axis === "h" ? "Horizontal" : "Vertical"}</span>
      </button>
    {/each}
  </div>
</FieldSection>
