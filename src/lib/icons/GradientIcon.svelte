<script lang="ts">
  import { Icon, type LucideProps } from "@lucide/svelte";

  /** The Gradient tool's icon (2026-09-28): halftone dots shrinking left to right — the print and
   *  design convention for a fade, and it reads as one even at the strip's 18px. Built on Lucide's
   *  `Icon` like every custom icon here. Each column carries its own stroke width (a zero-length
   *  path with round caps is a dot of that diameter): the one deliberate break from Lucide's
   *  uniform 2px, so these dots would not follow a `strokeWidth` prop — nothing passes one. */
  let props: LucideProps = $props();

  const COLUMNS = [
    [5, "4.2"],
    [10, "3.1"],
    [14.5, "2.1"],
    [19, "1.2"],
  ] as const;

  const icon = {
    name: "gradient",
    size: 24,
    node: COLUMNS.flatMap(([x, w]) =>
      [5, 12, 19].map((y) => ["path", { d: `M${x} ${y}h.01`, "stroke-width": w }] as const),
    ),
  };
</script>

<Icon {...props} {icon} />
