<script lang="ts">
  import { TextAlignCenter, TextAlignEnd, TextAlignStart } from "@lucide/svelte";
  import type { PathShape } from "../doc/document";
  import {
    addFontFile,
    beginDocGesture,
    endDocGesture,
    titleGestureEpoch,
    titleInFlight,
    fontsChangedTick,
    app,
    clearCharOverride,
    rerollTitle,
    setCharOverride,
    setTitleFont,
    setTitleOpts,
    setTitleText,
    typeTitleText,
  } from "../state/appState.svelte";
  import { fontAvailable, fontChoices } from "../text/font";
  import { charTransform, withOverride } from "../text/random";
  import FieldSection from "./FieldSection.svelte";
  import NumberField from "./NumberField.svelte";

  /** Spec (M10) §6. Typing happens here rather than on the canvas so the iPad keyboard never
   *  covers the artwork, and so this reuses the panel machinery instead of inventing a caret. */
  let { title }: { title: PathShape } = $props();

  type CharT = ReturnType<typeof charTransform>;

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

  /** Typing is a live drag by another name (invariant 41): the whole burst is bracketed in one
   *  document gesture, so undo steps back over the word you typed rather than the letter. The
   *  bracket must close on every way typing can end — the blur, and destruction of this component,
   *  because clearing the selection removes the panel mid-burst and a gesture left open silently
   *  stops recording undo history for everything after it. */
  let typing = false;
  let typingEpoch = 0;

  function startTyping() {
    if (typing) return;
    typing = true;
    typingEpoch = beginDocGesture();
  }

  function endTyping() {
    if (!typing) return;
    typing = false;
    endDocGesture();
  }

  // Unmount is the usual end of a burst (the selection changed). Closing the gesture before the
  // outline drain finishes splits the word into extra undo steps. Wait for that drain, and only
  // close the bracket if a newer gesture has not started.
  $effect(() => () => {
    if (!typing) return;
    typing = false;
    const epoch = typingEpoch;
    void titleInFlight().then(() => {
      if (titleGestureEpoch() === epoch) endDocGesture();
    });
  });

  /** Spec M10 §6 sketches sliders; this app has no range input anywhere, and `NumberField` is the
   *  control it does have — already styled, already 32px for touch, and it already guards a no-op
   *  change, which invariant 1 needs. */
  const AMOUNTS = [
    { key: "rotate", label: "Rotation", max: 45, suffix: "°" },
    { key: "scale", label: "Scale", max: 50, suffix: "%" },
    { key: "offset", label: "Baseline", max: 50, suffix: "px" },
    { key: "skew", label: "Skew", max: 45, suffix: "°" },
  ] as const;

  /** Scale is stored as a fraction and shown as a percentage. */
  const amountValue = (k: (typeof AMOUNTS)[number]["key"]) =>
    k === "scale" ? Math.round(meta.amounts.scale * 100) : meta.amounts[k];

  const setAmount = (k: (typeof AMOUNTS)[number]["key"], v: number) =>
    void setTitleOpts({ amounts: { ...meta.amounts, [k]: k === "scale" ? v / 100 : v } });

  /** Spec M10 §6. The Randomise block's numbers are **ranges** (±12°); these are **the value**
   *  (−12°) for one character. Same four properties, different quantities — so they never share a
   *  field, and the labels say which is which. */
  const charIndex = $derived(app.charSel);
  const effective = $derived(
    charIndex === null
      ? null
      : withOverride(charTransform(meta.seed, charIndex, meta.amounts), meta.overrides[charIndex]),
  );
  const CHAR_FIELDS = [
    { key: "r", label: "Rotation", suffix: "°", of: (t: CharT) => t.rotate },
    { key: "s", label: "Scale", suffix: "%", of: (t: CharT) => Math.round(t.scale * 100) },
    { key: "dy", label: "Baseline", suffix: "px", of: (t: CharT) => t.dy },
    { key: "k", label: "Skew", suffix: "°", of: (t: CharT) => t.skew },
  ] as const;

  const setChar = (k: (typeof CHAR_FIELDS)[number]["key"], v: number) =>
    void setCharOverride({ [k]: k === "s" ? v / 100 : v });

  /** Alignment is not a position — it decides which edge stays put when the title changes, because
   *  re-typing re-derives the outlines from the anchor. Flush-line icons, not arrows: an arrow says
   *  "move this way", and pressing "right" actually makes the text extend leftwards from a pinned
   *  right edge, so the arrows read as inverted. */
  const ALIGNS = [
    { v: "left", label: "Left edge stays put as the text changes", icon: TextAlignStart },
    { v: "center", label: "Stays centred as the text changes", icon: TextAlignCenter },
    { v: "right", label: "Right edge stays put as the text changes", icon: TextAlignEnd },
  ] as const;
</script>

<FieldSection id="text" title="Text">
  <!-- A textarea, not an input: Return must insert a line break, so it is deliberately NOT
       intercepted. The canvas follows every keystroke (spec M10e §5); `blur` is the commit, and
       the only place a refusal is reported or the field put back. -->
  <textarea
    class="field field-full resize-y py-1 leading-snug"
    rows="2"
    aria-label="Title text"
    value={meta.text}
    aria-disabled={!ready}
    title={ready ? "Change the text" : missing}
    oninput={(e) => {
      if (!ready) return;
      startTyping();
      void typeTitleText(e.currentTarget.value);
    }}
    onblur={async (e) => {
      if (!ready) return;
      const el = e.currentTarget;
      // Commit first, THEN close the gesture: `endDocGesture` records the burst as one undo step,
      // and a commit after it would be a second step of its own.
      await setTitleText(el.value);
      endTyping();
      // A refusal — an unshaped script, a font with no such glyphs, an empty string — leaves the
      // title alone, so put the field back rather than leaving the rejected text in it. Only here:
      // doing it per keystroke would yank the caret back mid-word. The panel may have been
      // destroyed while awaiting, so `isConnected` is checked first.
      if (el.isConnected) el.value = title.text?.text ?? el.value;
    }}></textarea>

  <div class="field-full flex items-center gap-2">
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
  <NumberField
    label="Line height"
    value={meta.lineHeight}
    min={0.5}
    max={4}
    suffix="×"
    onchange={(v) => ready && void setTitleOpts({ lineHeight: v })}
  />

  <div class="field-full flex items-center gap-1">
    {#each ALIGNS as a (a.v)}
      <button
        class={["btn flex-1 justify-center", meta.align === a.v && "ui-on"]}
        aria-pressed={meta.align === a.v}
        aria-disabled={!ready}
        title={ready ? a.label : missing}
        onclick={() => ready && void setTitleOpts({ align: a.v })}
      >
        <a.icon size={16} />
      </button>
    {/each}
  </div>
</FieldSection>

<!-- Character and Randomise are alternatives, and neither belongs inside the Text section: picking
     a character replaces the whole-title controls with that character's own. Character is
     deliberately NOT collapsible — it appears only while a character is picked, and a chevron that
     hid the thing the click just selected would be absurd. -->
{#if charIndex !== null && effective}
  <div class="field-full mt-1 flex items-center justify-between">
    <span class="section-title">Character {charIndex + 1}</span>
    <button
      class="btn"
      title="Clear this character's overrides and let the randomiser have it back"
      onclick={() => void clearCharOverride()}
    >
      Reset
    </button>
  </div>
  <p class="field-full text-[11px] text-muted">
    Exact values for this character. The rest of the title is untouched, and these survive a
    re-roll.
  </p>
  {#each CHAR_FIELDS as c (c.key)}
    <NumberField
      label={c.label}
      value={c.of(effective)}
      suffix={c.suffix}
      onchange={(v) => ready && setChar(c.key, v)}
    />
  {/each}
{:else}
  <FieldSection id="randomise" title="Randomise">
    <!-- The seed moved out of the heading row: a section heading is now a button, and a button
         inside a button is invalid HTML. -->
    <div class="field-full">
      <button
        class="btn w-full justify-center"
        aria-disabled={!ready}
        title={ready ? "Re-roll the randomiser" : missing}
        onclick={() => ready && void rerollTitle()}
      >
        ↻ Seed {meta.seed}
      </button>
    </div>
    {#each AMOUNTS as a (a.key)}
      <NumberField
        label={a.label}
        value={amountValue(a.key)}
        min={0}
        max={a.max}
        suffix={a.suffix}
        onchange={(v) => ready && setAmount(a.key, v)}
      />
    {/each}
  </FieldSection>
{/if}
