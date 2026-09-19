# slop-vector-editor — milestone 6 design: selection conveniences

Date: 2026-09-19. Status: approved in brainstorming. The first post-v1 milestone, after M5 closed the
original plan (project design §9). It adds the selection commands the app has never had — it has no
Select All at all today — and the "find everything this colour" command that prompted it.

Boolean operations (merge, subtract, intersect, exclude) were asked for in the same breath and are
**not** here: they are curve geometry, not selection, and they get their own spec as M7. That spec is
already decided on one point — Paper.js as a geometry-only helper, per project design §10 and the
brainstorming ruling — and nothing in this milestone should anticipate it.

## 1. Scope

In:

- **Select All** and **Invert Selection**, with shortcuts (§2);
- **Select Same Fill / Stroke / Style / Kind**, driven by the current selection (§3);
- a **Select menu** in the top bar and the same entries in the context menu (§5);
- the pure matching and reach rules, and their tests (§4, §8).

Out:

- **Boolean operations** — M7, with its own spec.
- **Align and distribute** — considered and deliberately deferred: it is a second feature with its
  own panel and geometry, and folding it in here would double the milestone.
- **Isolate / lock others** — it writes `visible` and `locked` to the document rather than changing
  what is selected, so it belongs with a document-editing milestone, not this one.
- Selecting by anything other than fill, stroke, style and kind — no "similar size", no tolerance
  slider, no saved selections.
- Any change to how selection itself works: marquee, Shift-add, entering groups and the Escape chain
  all stay exactly as they are.

## 2. Select All and Invert Selection

- **Select All** (⌘A) selects every id in reach (§4).
- **Invert Selection** (⇧⌘A) selects everything in reach that is not selected now. Inverting a full
  selection therefore clears it, which is correct and needs no special case.

⌘A is currently unhandled, so the browser runs its own select-all over the app chrome. Claiming it
fixes that. `App.svelte` already exempts `INPUT`, `TEXTAREA`, `SELECT` and `contentEditable` from
editing keys, so ⌘A keeps its native meaning inside the file-name field and the number fields.

## 3. Select Same

Four commands, each reading the current selection and selecting everything in reach that matches it:

| Command | Matches on |
| --- | --- |
| Same Fill Colour | `style.fill` |
| Same Stroke Colour | `style.stroke` |
| Same Style | every field of `Style` — both paints, `strokeWidth`, `cap`, `join`, `opacity` |
| Same Kind | `node.kind` |

- **Paints compare exactly.** `Paint` is `{ color, opacity }` with a lowercase `#rrggbb`; two paints
  match when both fields are equal. `null` (no fill / no stroke) matches `null` and nothing else.
  There is no tolerance: the document stores what the user picked, and "nearly the same orange" is a
  different colour.
- **Several seeds mean union, not intersection.** With an orange and a blue shape selected, Same
  Fill selects every orange shape *and* every blue one. Requiring a match against all seeds would
  make the command useless on a mixed selection, which is exactly when it is reached for.
- **The seeds match themselves**, so the selection never shrinks — Same Fill on one orange shape
  returns at least that shape.
- **Groups have no `Style`.** A group can be a seed and a match for Same Kind. For the three style
  commands it contributes no matches and is never returned as one — but a group already selected is
  **kept**, because the selection never shrinks. A selection of only groups disables those three
  commands anyway (§6), so this only matters for a mixed selection.
- **A seed that is out of reach is kept too.** The layers panel selects a row at any depth and
  points `enteredGroupId` at that row's parent, so the selection can hold ids that
  `selectableIds` would not offer. Matching alone would then find nothing and silently clear the
  selection; keeping the seeds makes "never shrinks" true in every case rather than only when the
  seeds happen to be in reach.
- The result is ordered by document order, not by when each shape matched, so the selection is
  stable and reproducible.

## 4. Reach

Every command in this milestone uses `selectableIds(doc, enteredGroupId)` from `src/doc/tree.ts`,
which already encodes the rule the rest of the app follows: inside an entered group, that group's
children; otherwise every top-level node on a visible, unlocked layer.

This is deliberate reuse, not coincidence. CLAUDE.md records that `selectableIds` is specified and
tested but no longer called in production, because `hitTest` and `marqueeSelect` re-implement its
rule inline — which is how the two drift. This milestone gives it callers again.

Consequences, all wanted: a hidden or locked layer is never selected into; a shape inside a group is
not matched unless you have entered that group; and Select All inside a group means "all of this
group's children", which is what entering a group implies.

## 5. Where the commands live

**A `Select` menu in the top bar, beside `File`.** Not "Edit": cut, copy and paste live in the icon
bar, and a menu called Edit would imply they had moved. The menu is a flat list — the top bar's File
menu and the context menu are both flat lists of `menu-item` buttons today, and neither has submenu
machinery. A nested `Select Same ▸` would mean inventing hover-to-open behaviour that also has to
work by long-press on iPad — which nothing supports today — for four entries:

```
File  Select ▾
  Select All          ⌘A
  Invert Selection   ⇧⌘A
  ────────────────
  Same Fill Colour
  Same Stroke Colour
  Same Style
  Same Kind
```

**The context menu** gets the same seven entries, in a section of its own: Select All and Invert
always, the four Same commands only when the selection makes them available.

**Correction, from the final review:** earlier drafts of this section called the context menu "the
iPad route". It is not. `Canvas.svelte` opens it only when `app.lastPointerType === "mouse"`, and
`routePointerDown` returns `"menu"` only for a right mouse button — CLAUDE.md invariant 16. There is
no long-press handler anywhere. The context menu is the **mouse** route; on a touch device the Select
menu in the top bar is the only way to these commands, and it works there. Nothing is lost, but the
rationale was wrong and would have sent someone to "fix" the context menu in a way that breaks
invariant 16.

The two menus differ deliberately on what an unavailable command looks like. The Select menu
**disables** it with a reason, like the top bar (§6). The context menu **hides** it, which is that
menu's existing pattern for Ungroup, Convert and Flatten: invariant 24 keeps disabled entries in the
top bar so the bar does not move, and a menu that appears under the pointer and vanishes again has
no layout to keep still.

## 6. When a command does not apply

In the **Select menu**, per CLAUDE.md invariant 24, a command that does not apply is shown disabled
with a reason, never hidden. (In the context menu it is hidden instead — see §5.) The reasons:

- nothing selected → the four Same commands read `Same Fill Colour — nothing selected`;
- only groups selected → `Same Fill Colour — a group has no fill`, and likewise for stroke and
  style. Same Kind stays available;
- nothing in reach at all (every layer hidden or locked) → `Select All — nothing to select`.

Invert Selection is always available: with nothing selected it selects everything, and with
everything selected it clears.

## 7. Architecture

- **`src/doc/select-match.ts`** (new, pure): the matching field type and three functions —
  `allIds(doc, enteredGroupId)`, `invertIds(doc, ids, enteredGroupId)` and
  `sameIds(doc, ids, enteredGroupId, field)`. They take a `Doc` and return `string[]`; they import
  nothing from the store and know nothing about menus.
- **`src/state/appState.svelte.ts`**: three actions wrapping them, each calling
  `cancelActiveGesture()` first and then `setSelection(...)`. These change no document, but a
  selection that moves under a running drag is the same hazard invariant 15 exists for, and the call
  is free.
- **`src/state/keys.ts`**: `EditAction` gains `selectAll` and `invertSelection`, mapped from ⌘A and
  ⇧⌘A in the modifier branch. The four Same commands are menu-only — they need no shortcuts, and
  inventing four more chords would cost more than it buys.
- **`src/state/properties.ts`**: `selectionActions` gains `canSelectSameStyle` (the selection holds
  at least one non-group) and `canSelectSameKind` (the selection is not empty), so both menus ask
  one place whether a command applies.
- **`src/lib/TopBar.svelte`**: the Select menu, built exactly like the File menu beside it — same
  button, same `role="menu"` panel, same backdrop-closes-it behaviour.
- **`src/lib/ContextMenu.svelte`**: the same entries.

## 8. Testing

- **Unit (Vitest, node):** `allIds`, `invertIds` and `sameIds` against a document with two layers,
  a group, a hidden layer and a locked layer — each of the four fields; `null` fill matching `null`
  and not matching a paint; two seeds giving a union; a group seed skipped by the style fields and
  honoured by kind; entering a group restricting every command to its children; document order;
  inverting a full selection giving an empty one. `editActionForKey` mapping ⌘A and ⇧⌘A, and *not*
  mapping a bare `a`.
- **Build:** 0 errors, 0 warnings; lint and format clean.
- **Browser (controller, port 5198, screenshots):** the Select menu opening, closing on a backdrop
  click and running each command; the same from the context menu; ⌘A and ⇧⌘A; ⌘A inside the
  file-name field still selecting its text; the disabled reasons appearing in the status bar on
  hover and on a touch press; Select Same finding shapes across layers but not on a hidden one; and
  inside an entered group, every command staying within it.

## 9. Owed

The iPad pass owed from M5 still stands and now covers the Select menu's hit targets at portrait
widths. It does **not** include the context menu: that menu is mouse-only (above), so on a device
the Select menu is the only route and the only thing to check. Nothing in this
milestone can be device-verified here.
