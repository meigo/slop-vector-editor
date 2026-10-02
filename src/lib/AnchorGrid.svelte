<script lang="ts">
  import type { Anchor } from "../doc/doc-resize";

  /** Spec M23 §2: which part of the drawing keeps its place when the page is cropped or extended. */
  let { ax, ay, onchange }: { ax: Anchor; ay: Anchor; onchange: (ax: Anchor, ay: Anchor) => void } =
    $props();

  const STEPS: Anchor[] = [0, 0.5, 1];
  const NAMES = [
    ["top left", "top", "top right"],
    ["left", "centre", "right"],
    ["bottom left", "bottom", "bottom right"],
  ];
</script>

<div class="grid w-fit grid-cols-3 gap-1" role="group" aria-label="Anchor">
  {#each STEPS as y, r (y)}
    {#each STEPS as x, c (x)}
      {@const on = x === ax && y === ay}
      <button
        type="button"
        class={["btn size-(--ctl-h) justify-center p-0", on && "ui-on"]}
        aria-pressed={on}
        aria-label={`Anchor ${NAMES[r][c]}`}
        title={`Anchor ${NAMES[r][c]} — that part of the drawing stays put`}
        onclick={() => onchange(x, y)}
      >
        <span class="block size-2 rounded-full bg-current"></span>
      </button>
    {/each}
  {/each}
</div>
