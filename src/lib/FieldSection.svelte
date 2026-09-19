<script lang="ts">
  import { ChevronDown, ChevronRight } from "@lucide/svelte";
  import type { Snippet } from "svelte";
  import type { SectionId } from "../persist/preferences";
  import { app, toggleSection } from "../state/appState.svelte";

  /** A collapsible section of the properties panel (spec M10e §1). It renders **no wrapper
   *  element**: the heading is the grid's full-width divider row and the rows are the caller's,
   *  so both land directly in the panel's one `.field-grid` (invariant 23). A wrapper here would
   *  start a second grid and take the columns back out of alignment. */
  let { id, title, children }: { id: SectionId; title: string; children: Snippet } = $props();

  const open = $derived(!app.prefs.closedSections.includes(id));
</script>

<button
  type="button"
  class="field-divider section-title flex items-center gap-1 text-left text-muted hover:text-text"
  aria-expanded={open}
  title={open ? `Hide the ${title} section` : `Show the ${title} section`}
  onclick={() => toggleSection(id)}
>
  {#if open}
    <ChevronDown size={12} />
  {:else}
    <ChevronRight size={12} />
  {/if}
  <span class="text-inherit">{title}</span>
</button>
{#if open}
  {@render children()}
{/if}
