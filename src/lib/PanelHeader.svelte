<script lang="ts">
  import { ChevronDown, ChevronRight } from "@lucide/svelte";
  import type { Snippet } from "svelte";

  /** A sidebar panel's header bar (spec M8 §3). It is raised, so the boundary between the two
   *  panels is a band of a different colour rather than a 1px line one palette step from its
   *  background — and content scrolling under it reads as continuing. The name is the collapse
   *  target, not just the chevron; the panel's own actions sit at the right. */
  let {
    title,
    open,
    showTitle,
    hideTitle,
    ontoggle,
    actions,
  }: {
    title: string;
    open: boolean;
    showTitle: string;
    hideTitle: string;
    ontoggle: () => void;
    actions?: Snippet;
  } = $props();
</script>

<!-- The rule is panel-coloured, not `border-line`: below an open panel it simply continues the body
     it sits on, and between two collapsed headers it is the darker line that keeps them apart.
     `border-line` (#2e2e35) against `bg-raised` (#2d2d33) would be the very non-boundary this
     milestone exists to remove — and two stacked headers is the default state. -->
<!-- `pr-0.5`: a 32px action holds an 18px icon with 7px of air, so its icon ends 9px from the edge —
     the same edge as the layer rows' 14px toggles in 20px boxes at a 6px inset. -->
<div class="flex h-10 shrink-0 items-center gap-1 border-b border-panel bg-raised pr-0.5 pl-1">
  <button
    type="button"
    class="flex h-8 items-center gap-1 rounded px-1 text-muted hover:text-text"
    aria-expanded={open}
    title={open ? hideTitle : showTitle}
    onclick={ontoggle}
  >
    {#if open}
      <ChevronDown size={14} />
    {:else}
      <ChevronRight size={14} />
    {/if}
    <span class="section-title text-inherit">{title}</span>
  </button>
  {#if actions}
    <div class="ml-auto flex items-center gap-1">{@render actions()}</div>
  {/if}
</div>
