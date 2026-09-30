# iPad checklist

The device pass owed since M5, collected from the CHANGELOG's "Owed" lines (2026-09-30). Every item
here passed in desktop Chrome, most with synthetic touch/Pencil events — this list is what only a
real iPad, a real finger and a real Pencil can confirm.

**Setup.** Use the deployed app (<https://slop-vector-editor.meigo.workers.dev>) in **Safari**
first, then the **Home Screen** app (Share ▸ Add to Home Screen), then **Chrome** only for the items
marked _Chrome_. Try each touch item with a **finger** and with the **Pencil** unless it says
otherwise. For a failure, note: browser, finger or Pencil, what you did, what happened — a
screenshot helps.

Priority: **P1** = likely to be broken or blocks basic use; **P2** = plausible problems; **P3** =
polish.

## 1. Navigation and gestures

- [x] **P1** Two-finger pinch zooms and pans smoothly; letting go leaves nothing selected or moved.
- [x] **P1** Two-finger **tap** undoes.
- [x] **P1** Three-finger tap redoes. (Watch for iPadOS taking three fingers for its own edit
      menu.)
- [x] **P2** A two-finger pinch that zooms never undoes.
- [x] **P2** A slow two-finger tap (held ~½ s), or one where the fingers slide a little, does
      nothing (no undo).
- [x] **P1** **Long press** (hold still ~½ s) on an object with the Select tool opens the context
      menu with that object selected; lifting the finger does **not** trigger a menu item; a tap on
      an item then works. Same with the Node tool (Delete node(s) in the menu). Same with the Pencil.
- [x] **P1** After the Pencil has been used once, one finger pans (never draws or selects).
- [x] **P1** **Fingers select** (the pointing-finger button in the dock, next to Shift/Alt): on,
      a quick finger tap selects and deselects after the Pencil has been used, a finger drag still
      pans, a finger long press opens the menu, and Brush/Pen/shapes never draw with a finger;
      off (the default), fingers only navigate. The choice survives a reload. _Both confirmed (off after a reload since `32beada`)._
- [x] **P1** Palm: rest the side of your hand on the glass while drawing with the Pencil — the
      stroke is not interrupted, the view does not jump, and lifting the palm does not undo.
- [x] **P2** A Pencil press over resting fingers takes over (the stroke starts, no pinch).
      _Known iPadOS limitation, accepted: with a finger already down the Pencil's touch never
      reaches the page (Safari and Chrome; `?debug` showed no event at all), so a finger-first
      stroke does not start. The Pencil first, then a finger or palm, draws fine._
- [x] **P2** Double tap (finger and Pencil) opens a path in the Node tool / enters text editing on
      a title.
- [x] **P2** Double tap a **group** on the canvas enters it (select two objects, Object ▸ Group or
      ⌘G, then double-tap one of them: the object inside gets selected, the group frame dashed).
- [x] **P1** Double-tapping or pinching anything outside the canvas (a layer's name, a panel, the
      top bar) never zooms the page. (If the whole screen magnifies, status bar included, that is
      iPadOS's own Zoom — a three-finger double tap toggles it.)
- [x] **P2** With page zoom blocked: double-tapping a layer's name still starts renaming it, and
      the layer list and Properties still scroll with a finger.
- [x] **P3** The Hand tool pans with a finger and with the Pencil.

## 2. Selecting and transforming

- [ ] **P1** Tap selects; tap on empty canvas deselects; drag on empty canvas makes a marquee.
- [ ] **P1** Corner handles scale **proportionally**; with Shift latched in the dock they stretch
      freely; edge handles stretch one way. Handles are easy to hit with a finger (14 px reach).
- [ ] **P1** A title resized from a corner stays **editable text**.
- [ ] **P2** Small objects: handles move outside so the middle is still draggable.
- [ ] **P1** Handles on a small title/object no longer hide it: smaller knobs (same reach), no
      side midpoints on a short side — drag that edge line instead; zoom in and they return.
- [ ] **P2** Rotate knob by finger and Pencil; Shift latched snaps to 15°.
- [ ] **P2** Modifier dock: Shift/Alt latch on tap, stay latched, unlatch on tap; with Shift
      latched a tap on empty canvas still clears the selection.
- [ ] **P3** Snap guides appear and clear after the drag.

## 3. Drawing tools

- [ ] **P1** **Brush** with the Pencil: pressure changes the width (try Taper off to see it
      clearly); fast curves stay smooth (no straight segments); a tap makes a dot.
- [ ] **P1** Brush: say whether **Taper on** (the default) hides pressure too much — a fixed taper
      length is a one-line change.
- [ ] **P2** Brush size cursor follows the Pencil while hovering (iPad Pro with M2 or later).
- [ ] **P2** Brush with a finger (before the Pencil is used): constant width; a second finger
      cancels the stroke and pinches.
- [ ] **P1** Hold the Pencil still for a second mid-stroke with **Brush** and **Pen**: the stroke
  survives (no context menu, no lost ink). A long press with Select/Node still opens the menu.
- [ ] **P2** Rectangle, ellipse, line, polygon, pen: draw by Pencil and finger; the pen's
      click/drag nodes and closing on the first node.
- [ ] **P2** Node tool: pick a path, drag nodes and handles, double-tap a segment to add a node,
      **Delete node** button in the Node section, top-bar Delete says "Delete nodes" and deletes
      only nodes.
- [ ] **P2** Gradient tool: knob reach — a radial's three knobs sit close on a small shape; the
      diamond (midpoint) is grabbable; the Midpoint slider drags by touch.
- [ ] **P2** Warp tool: cage corner and handle knobs reachable; a palm mid-drag; Enter/Escape via
      the dock's keyboard-less routes (switching tool commits).

## 4. Text

- [ ] **P1** Text tool: tap empty canvas → a title appears with "Text" selected **and the
      keyboard comes up** (first placement of the session, and again later).
- [ ] **P1** Typing replaces "Text"; Backspace to empty shows just the caret (no old text); typing
      again shows exactly what you type; tap away with it empty removes the title.
- [ ] **P1** Tap inside a title while editing moves the caret (the keyboard stays up); drag
      selects text; the one-character selection shows the Character sliders and can be dragged.
- [ ] **P1** **Auto-pan**: edit a title low on the screen — the canvas moves so the caret stays
      above the keyboard.
- [ ] **P2** Dismiss the keyboard with its own key → editing ends, text kept; the keyboard does
      not pop back up immediately.
- [ ] **P2** Dictation; long-press accents (ä, õ, š); predictive text / autocorrect replacing a
      word; paste over a selection.
- [ ] **P2** Hardware keyboard (Magic Keyboard): arrows, Shift-arrows, ↑/↓ between lines,
      Escape, ⌘A, ⌘Z inside the text, ⌘S saves while editing.
- [ ] **P2** Tap a panel button (e.g. a layer's eye) while editing — the session ends cleanly (no
      stuck caret, keyboard goes away or stays usable).
- [ ] **P2** Per-character rotation now turns each letter about its centre (Randomise section).
- [ ] **P3** Google Fonts dialog: search typing speed, scrolling ~2000 rows, Add; the Weight select
      and Italic toggle.
- [ ] **P3** _Chrome_: the page shifts up after the keyboard closes (known, unfixable) — confirm it
      is no worse than in the other slop apps.

## 5. Panels and bars

- [ ] **P1** Every control is at least a comfortable finger target (32 px); nothing needs hover.
- [ ] **P1** Tapping any control shows its hint in the status bar (there is no hover tooltip).
- [ ] **P2** Number fields: drag sideways to scrub; a vertical swipe on the panel still scrolls.
- [ ] **P2** Sidebar: drag its width grip; drag the Layers/Properties divider; collapse and expand
      each panel; Properties opens with the Brush tool active.
- [ ] **P2** Layers panel: drag rows to reorder and into groups; eye and lock toggles; the trash.
- [ ] **P3** Double-tap the name of a hidden or locked object's row: it renames (a single tap still
      does not select it).
- [ ] **P2** Portrait (below 900 px): the sidebar becomes a drawer; the top bar never wraps or
      clips the File menu.
- [ ] **P2** Menus (File, Edit, Select, Path, Object) open and close by tap; items work.
- [ ] **P3** Colour pickers (fill, stroke, gradient stops) open and apply; one undo per pick.

## 6. Files

- [ ] **P1** **Save** and **Save As**: the share sheet opens and **Save to Files** writes the
      file; the "ready" dialog appears when a fresh tap is needed and its buttons work.
- [ ] **P1** **Open…** and **Import SVG…** show the Files picker; import adds to the current layer.
- [ ] **P2** Export PNG (dialog, share sheet); Copy PNG to the clipboard.
- [ ] **P2** Close Safari and reopen: autosave restored the document.
- [ ] **P3** Copy/paste between the app and another app (Notes, Figma) as SVG.

## 7. Home Screen app

- [ ] **P2** Add to Home Screen: icon, name, standalone (no browser bar); everything above still
      works; the keyboard behaves (standalone runs on Safari's engine).

## 8. Performance (report only if it feels slow)

- [ ] **P3** A long Brush stroke (full screen, fast) keeps up with the Pencil.
- [ ] **P3** Warp and resize on a large selection; many node knobs in the Node tool.
