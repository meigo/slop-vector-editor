<script lang="ts">
  import type { PathShape } from "../doc/document";
  import {
    addFontFile,
    fontsChangedTick,
    setTitleFont,
    setTitleOpts,
    setTitleText,
  } from "../state/appState.svelte";
  import { fontAvailable, fontChoices } from "../text/font";
  import NumberField from "./NumberField.svelte";

  /** Spec (M10) §6. Typing happens here rather than on the canvas so the iPad keyboard never
   *  covers the artwork, and so this reuses the panel machinery instead of inventing a caret. */
  let { title }: { title: PathShape } = $props();

  const meta = $derived(title.text!);
  const ready = $derived(fontAvailable(meta.font));
  // `fontsChangedTick()` is the tracked dependency: `fontChoices()` reads plain Maps that
  // Svelte cannot see, so without it a font you just added never reaches the list.
  const choices = $derived((fontsChangedTick(), fontChoices()));
  const label = $derived(choices.find((c) => c.id === meta.font)?.label ?? meta.font);
  /** Every control here re-derives geometry, so all of them need the font (spec §5) — not just the
   *  string field. The font picker is the exception: switching to a font you DO have is the way
   *  out, so it stays live and says so. */
  const missing = $derived(`Needs the font “${label}”, which isn't loaded — add it from a file`);

  let picker: HTMLInputElement | null = $state(null);

  const ALIGNS = [
    { v: "left", label: "Align left" },
    { v: "center", label: "Align centre" },
    { v: "right", label: "Align right" },
  ] as const;
</script>

<div class="flex flex-col gap-2 border-t border-line pt-3">
  <span class="section-title">Text</span>

  <input
    class="field"
    aria-label="Title text"
    value={meta.text}
    aria-disabled={!ready}
    title={ready ? "Change the text" : missing}
    onchange={async (e) => {
      if (!ready) return;
      const el = e.currentTarget;
      await setTitleText(el.value);
      // A refusal — an unshaped script, a font with no such glyphs, an empty string — leaves the
      // title alone, so put the field back rather than leaving the rejected text in it. The panel
      // may have been destroyed while awaiting (deselecting blurs the field, which fires this),
      // so `isConnected` is checked before touching it or reading `meta`.
      if (el.isConnected) el.value = title.text?.text ?? el.value;
    }}
  />

  <div class="flex items-center gap-2">
    <select
      class="field min-w-0 flex-1"
      aria-label="Font"
      title="Change the font"
      value={meta.font}
      onchange={async (e) => {
        const el = e.currentTarget;
        await setTitleFont(el.value);
        // Uncontrolled, like the string field: a refused change leaves `meta.font` untouched, so
        // Svelte re-applies nothing and the dropdown would keep showing a font the title isn't in.
        if (el.isConnected) el.value = title.text?.font ?? el.value;
      }}
    >
      {#each choices as c (c.id)}
        <option value={c.id}>{c.label}</option>
      {/each}
      {#if !choices.some((c) => c.id === meta.font)}
        <option value={meta.font}>{meta.font} (not loaded)</option>
      {/if}
    </select>
    <button class="btn" title="Add a font from a file" onclick={() => picker?.click()}>
      Add a font…
    </button>
    <input
      bind:this={picker}
      type="file"
      accept=".ttf,.otf,.woff"
      class="hidden"
      aria-hidden="true"
      tabindex="-1"
      onchange={(e) => {
        const f = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        if (f) void addFontFile(f);
      }}
    />
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <NumberField
      label="Size"
      value={meta.size}
      min={1}
      onchange={(v) => ready && void setTitleOpts({ size: v })}
    />
    <NumberField
      label="Spacing"
      value={meta.letterSpacing}
      onchange={(v) => ready && void setTitleOpts({ letterSpacing: v })}
    />
  </div>

  <div class="flex items-center gap-1">
    {#each ALIGNS as a (a.v)}
      <button
        class={["btn flex-1", meta.align === a.v && "ui-on"]}
        aria-pressed={meta.align === a.v}
        aria-disabled={!ready}
        title={ready ? a.label : missing}
        onclick={() => ready && void setTitleOpts({ align: a.v })}
      >
        {a.v === "left" ? "⇤" : a.v === "center" ? "⇔" : "⇥"}
      </button>
    {/each}
  </div>
</div>
