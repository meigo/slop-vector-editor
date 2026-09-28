<script lang="ts">
  import { Icon, type LucideProps } from "@lucide/svelte";

  /** The Warp tool's icon (2026-09-28): an arch envelope — four round corner handles, the language
   *  of Lucide's `vector-square`, with the top and bottom edges bent. Built on Lucide's own `Icon`
   *  exactly as its shipped icons are, so it takes the same props and renders on the same 24×24
   *  grid with the same 2px round stroke. The handles are r=2.25, a quarter-unit over Lucide's usual
   *  r=2: each has two lines joining it (the Node tool's `spline-pointer` has one), which thickens
   *  the ring and made r=2 read smaller than the Node icon's circles at 18px — optical compensation. */
  let props: LucideProps = $props();

  const icon = {
    name: "warp",
    size: 24,
    node: [
      ["path", { d: "M7 6.2C10 3.6 14 3.6 17 6.2" }],
      ["path", { d: "M7 17.8C10 15.2 14 15.2 17 17.8" }],
      ["path", { d: "M5 9v6" }],
      ["path", { d: "M19 9v6" }],
      ["circle", { cx: "5", cy: "7", r: "2.25" }],
      ["circle", { cx: "19", cy: "7", r: "2.25" }],
      ["circle", { cx: "5", cy: "17", r: "2.25" }],
      ["circle", { cx: "19", cy: "17", r: "2.25" }],
    ],
  } as const;
</script>

<Icon {...props} {icon} />
