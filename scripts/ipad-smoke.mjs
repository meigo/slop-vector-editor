// iPad smoke check (`npm run test:ipad`): the app in WebKit — Safari's engine — at iPad Pro 11
// size with touch, in a fresh profile (its own IndexedDB and localStorage: never your autosave).
// Ported from slop-paint's `tools/ipad-smoke.mjs` (2026-10-01), extended the same day.
//
//   npm run test:ipad                     starts its own dev server on a free port
//   npm run test:ipad -- <url>            checks that URL instead (e.g. the deployed site)
//
// Screenshots go to test-results/ipad/. Exits 1 when a check fails or the page reports an error.
//
// Two kinds of input, and they are not equally strong evidence:
//   - REAL taps (`tap`): Playwright's touchscreen, which WebKit turns into a genuine touch — the
//     browser makes the pointer, touch and click events itself. Playwright can only tap.
//   - SIMULATED gestures (`gesture`, checks marked [sim]): drags, holds, the Pencil and every
//     multi-finger gesture are pointer events this script dispatches — the full sequence a direct
//     pointer produces (over, enter, down, moves, up, out, leave), each pointer's events on the
//     element it went down on. They test the app's routing and tools, not what iPadOS delivers.
// Not covered — test these on the iPad itself (docs/superpowers/IPAD-CHECKLIST.md): the real
// Pencil (pressure, hover, palm), how gestures feel, the on-screen keyboard and auto-pan, the real
// share sheet (stubbed here: `navigator.share` records the file), iPadOS memory limits.
// First run on a machine: `npx playwright install webkit` (~100 MB).
import { Buffer } from "node:buffer";
import { mkdirSync } from "node:fs";
import process from "node:process";
import { devices, webkit } from "playwright";
import { createServer } from "vite";

const OUT = "test-results/ipad";
mkdirSync(OUT, { recursive: true });

let server = null;
let url = process.argv[2];
if (!url) {
  server = await createServer({ server: { port: 0 }, logLevel: "error" });
  await server.listen();
  url = server.resolvedUrls.local[0];
}

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

/** Polls `fn` until it returns truthy or `ms` pass; returns the last value. */
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  let v = await fn();
  while (!v && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 100));
    v = await fn();
  }
  return v;
}

/** Runs in the page before the app. */
function pageSetup() {
  // Simulated pointers aren't live, so WebKit refuses to capture them ("The object can not be
  // found here"); a real Pencil or finger is one. Let capture fail quietly for the simulation.
  const capture = Element.prototype.setPointerCapture;
  Element.prototype.setPointerCapture = function (id) {
    try {
      capture.call(this, id);
    } catch {
      /* simulated pointer */
    }
  };

  // The share sheet, stubbed: Save and Export reach `navigator.share` exactly as on the iPad
  // (WebKit with an iPad user agent counts as an Apple touch device), and it records the file.
  window.__shared = [];
  Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: async ({ files }) => {
      for (const f of files)
        window.__shared.push({
          name: f.name,
          type: f.type,
          size: f.size,
          text: f.type === "image/svg+xml" ? await f.text() : "",
        });
    },
  });

  /** Plays simulated pointer steps: `{ type: "down" | "move" | "up" | "cancel", id, kind, x, y,
   *  p?, wait? }`, or `{ type: "click", x, y }` for the click a browser may add after a lift.
   *  The pointers' down targets outlive a call, so a check can stop mid-gesture, look, and end it
   *  with another. */
  window.__gesture = async (steps) => {
    const targets = (window.__targets ??= new Map());
    const fire = (el, type, s, extra) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: type !== "pointerenter" && type !== "pointerleave",
          cancelable: true,
          composed: true,
          pointerId: s.id,
          pointerType: s.kind,
          isPrimary: targets.size === 1,
          clientX: s.x,
          clientY: s.y,
          width: s.kind === "touch" ? 20 : 1,
          height: s.kind === "touch" ? 20 : 1,
          pressure: s.p ?? 0.5,
          ...extra,
        }),
      );
    for (const s of steps) {
      if (s.wait) await new Promise((r) => setTimeout(r, s.wait));
      if (s.type === "click") {
        document.elementFromPoint(s.x, s.y)?.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            clientX: s.x,
            clientY: s.y,
          }),
        );
      } else if (s.type === "down") {
        const el = document.elementFromPoint(s.x, s.y);
        targets.set(s.id, el);
        fire(el, "pointerover", s, { buttons: 1 });
        fire(el, "pointerenter", s, { buttons: 1 });
        fire(el, "pointerdown", s, { button: 0, buttons: 1 });
      } else if (s.type === "move") {
        fire(targets.get(s.id), "pointermove", s, { button: -1, buttons: 1 });
      } else {
        const el = targets.get(s.id);
        const end = s.type === "up" ? "pointerup" : "pointercancel";
        fire(el, end, s, { button: 0, buttons: 0, pressure: 0 });
        fire(el, "pointerout", s, { buttons: 0, pressure: 0, relatedTarget: null });
        fire(el, "pointerleave", s, { buttons: 0, pressure: 0, relatedTarget: null });
        targets.delete(s.id);
      }
    }
  };
}

/** Steps for one pointer dragged from `a` to `b`, optionally held still first. */
function dragSteps(kind, id, a, b, { n = 10, hold = 0, wait = 16, p = () => 0.5 } = {}) {
  const steps = [{ type: "down", id, kind, x: a.x, y: a.y, p: p(0) }];
  if (hold) steps.push({ type: "move", id, kind, x: a.x, y: a.y, p: p(0), wait: hold });
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    steps.push({
      type: "move",
      id,
      kind,
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      p: p(t),
      wait,
    });
  }
  steps.push({ type: "up", id, kind, x: b.x, y: b.y, wait });
  return steps;
}

const browser = await webkit.launch();
try {
  // ---------------------------------------------------------------- landscape, the main pass
  const context = await browser.newContext({ ...devices["iPad Pro 11 landscape"] });
  await context.addInitScript(pageSetup);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  const canvas = page.locator('[aria-label="Drawing canvas"]');
  const gesture = (steps) => page.evaluate((s) => window.__gesture(s), steps);
  const tap = (p) => page.touchscreen.tap(p.x, p.y);
  const tapTool = (label) =>
    page.getByRole("navigation", { name: "Tools" }).getByRole("button", { name: label }).tap();
  /** Opens a top-bar menu and taps one of its items. */
  async function menu(name, item) {
    await page.locator("header button[aria-haspopup=menu]", { hasText: name }).tap();
    await page.getByRole("menuitem", { name: item }).tap();
    await page.waitForTimeout(200);
  }
  /** Select ▸ Deselect, which is greyed out (and ignores a tap) with nothing selected. */
  const deselect = async () => (await selected()) > 0 && menu("Select", /^Deselect/);
  const undoTitle = () =>
    page.getByRole("button", { name: "Undo", exact: true }).getAttribute("title");
  const width = async () => Number(await page.getByLabel("W", { exact: true }).inputValue());
  const hint = () => page.locator("footer > span").first().innerText();
  const selected = async () => {
    const m = /(\d+) selected/.exec(await page.locator("footer").innerText());
    return m ? Number(m[1]) : 0;
  };
  /** Top-level objects across the layers, as the canvas renders them. */
  const objects = () =>
    canvas.evaluate((h) => h.querySelectorAll(":scope > svg > g[transform] > g > *").length);
  /** The on-screen box of the `i`-th top-level object, oldest first. */
  const objectBox = (i) =>
    canvas
      .locator(":scope > svg > g[transform] > g > *")
      .nth(i)
      .boundingBox()
      .then((b) => ({ ...b, cx: b.x + b.width / 2, cy: b.y + b.height / 2 }));
  const zoom = () => page.getByTitle(/^Zoom to 100%/).innerText();
  const shared = () => page.evaluate(() => window.__shared);

  // 1. Loads.
  await page.goto(url);
  await canvas.waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/1-loaded.png` });
  check(true, `loads (${url})`);
  const hb = await canvas.boundingBox();
  const at = (fx, fy) => ({ x: hb.x + hb.width * fx, y: hb.y + hb.height * fy });

  // 2. A real touch tap opens the File menu, and a tap outside closes it (there is no Escape on the
  //    iPad; Escape is parked keyboard work).
  await page.getByRole("button", { name: /^File/ }).tap();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/2-menu.png` });
  const opened = (await page.locator('[role="menu"]').count()) > 0;
  await tap(at(0.9, 0.9));
  await page.waitForTimeout(300);
  const closed = (await page.locator('[role="menu"]').count()) === 0;
  check(opened && closed, "a finger tap opens the File menu, and a tap outside closes it");

  // 3. A tapped control's title shows in the status bar — iPadOS has no hover tooltip, so this is
  //    the only way an icon's label reaches the user. A real tap: its lift fires `pointerout`, which
  //    once cleared the hint on the device while a synthetic check passed (M5).
  const fit = page.getByTitle(/^Fit artboard/);
  await fit.tap();
  await page.waitForTimeout(200);
  const fitTitle = await fit.getAttribute("title");
  const shownHint = await hint();
  check(shownHint === fitTitle, `a tapped icon's title shows in the status bar ("${shownHint}")`);

  // 4. [sim] A thin rectangle, drawn with a finger; its corner, dragged with a finger, scales it
  //    uniformly by the pointer's travel along its diagonal (review M14): a 6 px nudge on the short
  //    side once made it 1.25× as long. The finger's reach is 10 px, the mouse's 6.
  await tapTool("Rectangle");
  const r0 = at(0.15, 0.2);
  const r1 = { x: r0.x + 300, y: r0.y + 24 };
  await gesture(dragSteps("touch", 11, r0, r1));
  await tapTool("Select");
  await page.waitForTimeout(300);
  const w0 = await width();
  await gesture(dragSteps("touch", 12, r1, { x: r1.x + 6, y: r1.y + 6 }));
  await page.waitForTimeout(300);
  const w1 = await width();
  await page.screenshot({ path: `${OUT}/4-corner.png` });
  check(
    w1 > w0 && w1 / w0 < 1.1,
    `[sim] a finger drags a thin rectangle's corner by the drag, not the short side (W ${w0} → ${w1})`,
  );

  // 5. Touch sizing: with a touch screen present (`any-pointer: coarse`) every field and button in
  //    the panels is 32 px high, every icon in the bars 32 px square (M10e §2), and every other
  //    button, input and select at least 32 × 32 (2026-10-01) — with two exceptions by design: a
  //    layer row's grip and chevron are 24 px wide (`--row-slot`; 32 would push nested rows too far
  //    right), and the sidebar's 8 px resize grip sits over a border.
  const sizes = await page.evaluate(() => {
    const box = (el) => el.getBoundingClientRect();
    const name = (el) =>
      el.getAttribute("aria-label") ?? el.getAttribute("title") ?? el.textContent.trim();
    const visible = (el) => box(el).width > 0 && box(el).height > 0;
    const size = (el) =>
      `${name(el) || el.tagName} ${Math.round(box(el).width)}×${Math.round(box(el).height)}`;
    const short = [...document.querySelectorAll(".btn, .field:not(textarea)")]
      .filter(visible)
      .filter((el) => box(el).height < 31.5)
      .map((el) => `${name(el) || el.tagName} ${Math.round(box(el).height)}px high`);
    const icons = [...document.querySelectorAll(".icon-btn")]
      .filter(visible)
      .filter((el) => box(el).height < 31.5 || box(el).width < 31.5)
      .map(size);
    const rowSlot = (el) =>
      !!el.closest("[data-row-id]") &&
      /^(Drag|Collapse|Expand) “/.test(el.getAttribute("aria-label") ?? "");
    const others = [...document.querySelectorAll("button, input, select")]
      .filter(visible)
      .filter((el) => !el.matches(".btn, .field, .icon-btn"))
      .filter((el) => !(el.getAttribute("aria-label") ?? "").startsWith("Resize the sidebar"));
    const small = others
      .filter((el) => box(el).height < 31.5 || box(el).width < (rowSlot(el) ? 23.5 : 31.5))
      .map(size);
    return {
      coarse: matchMedia("(any-pointer: coarse)").matches,
      fields: document.querySelectorAll(".btn, .field").length,
      others: others.length,
      bad: [...new Set([...short, ...icons, ...small])],
    };
  });
  check(
    sizes.coarse && sizes.fields > 5 && sizes.others > 10 && sizes.bad.length === 0,
    `touch targets are 32 px (${sizes.fields} fields and buttons, ${sizes.others} other controls${
      sizes.bad.length ? `; too small: ${sizes.bad.join(", ")}` : ""
    })`,
  );

  // 6. Real taps select: a tap on the rectangle selects it, a tap on empty canvas clears it. With
  //    Shift latched in the dock (which opened on the first touch), a tap on empty canvas must still
  //    clear (invariant 38: a latch can't be let go of the way a held key can).
  const rect = await objectBox(0);
  await tap(at(0.7, 0.85));
  await page.waitForTimeout(200);
  const none = await selected();
  await tap({ x: rect.cx, y: rect.cy });
  await page.waitForTimeout(200);
  const one = await selected();
  check(none === 0 && one === 1, `a tap on empty canvas deselects, a tap on an object selects it`);

  const shift = page.getByRole("toolbar", { name: "Modifier keys" }).getByRole("button", {
    name: "Shift",
    exact: true,
  });
  await shift.tap();
  const latched = (await shift.getAttribute("aria-pressed")) === "true";
  await tap(at(0.7, 0.85));
  await page.waitForTimeout(200);
  const clearedLatched = (await selected()) === 0;
  await shift.tap();
  const unlatched = (await shift.getAttribute("aria-pressed")) === "false";
  await page.screenshot({ path: `${OUT}/6-dock.png` });
  check(
    latched && clearedLatched && unlatched,
    "the dock's Shift latches on a tap, a tap on empty canvas still deselects, a tap unlatches",
  );

  // 7. [sim] A long press on an object with the Select tool opens the context menu with that object
  //    selected. The menu opens at the press, so a finger lifting a few px off (inside the 10 px
  //    slop) is over Cut: the click a browser may add after that lift must not run it. A
  //    deliberate tap on Cut then works.
  const before = await objects();
  const lift = { x: rect.cx + 4, y: rect.cy + 8 };
  await gesture([
    { type: "down", id: 13, kind: "touch", x: rect.cx, y: rect.cy },
    { type: "move", id: 13, kind: "touch", ...lift, wait: 700 },
    { type: "up", id: 13, kind: "touch", ...lift, wait: 20 },
    { type: "click", ...lift, wait: 10 },
  ]);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/7-long-press.png` });
  const menuOpen = (await page.getByRole("menuitem", { name: /^Cut/ }).count()) === 1;
  const selectedByPress = await selected();
  const survived = (await objects()) === before;
  if (menuOpen) await page.getByRole("menuitem", { name: /^Cut/ }).tap();
  await page.waitForTimeout(200);
  const cut = (await objects()) === before - 1;
  check(
    menuOpen && selectedByPress === 1 && survived && cut,
    `[sim] a long press opens the context menu with the object selected; its lift runs nothing; a tap on Cut cuts`,
  );

  // 8. [sim] Two-finger tap = undo (the Cut comes back), three-finger tap = redo. A two-finger
  //    pinch zooms and is never taken for an undo.
  const c = at(0.5, 0.6);
  const fingers = (n, id) =>
    Array.from({ length: n }, (_, i) => ({ id: id + i, x: c.x + i * 60, y: c.y }));
  const multiTap = (fs) => [
    ...fs.map((f, i) => ({ type: "down", kind: "touch", ...f, wait: i ? 15 : 0 })),
    ...fs.map((f, i) => ({ type: "up", kind: "touch", ...f, wait: i ? 10 : 80 })),
  ];
  await gesture(multiTap(fingers(2, 20)));
  await page.waitForTimeout(250);
  const undone = (await objects()) === before;
  await gesture(multiTap(fingers(3, 30)));
  await page.waitForTimeout(250);
  const redone = (await objects()) === before - 1;
  await gesture(multiTap(fingers(2, 40)));
  await page.waitForTimeout(250);
  check(
    undone && redone && (await objects()) === before,
    "[sim] a two-finger tap undoes and a three-finger tap redoes",
  );

  const z0 = await zoom();
  const undo0 = await undoTitle();
  const pinch = [
    { type: "down", id: 50, kind: "touch", x: c.x - 40, y: c.y },
    { type: "down", id: 51, kind: "touch", x: c.x + 40, y: c.y, wait: 15 },
  ];
  for (let i = 1; i <= 10; i++) {
    pinch.push({ type: "move", id: 50, kind: "touch", x: c.x - 40 - i * 8, y: c.y, wait: 16 });
    pinch.push({ type: "move", id: 51, kind: "touch", x: c.x + 40 + i * 8, y: c.y });
  }
  pinch.push({ type: "up", id: 50, kind: "touch", x: c.x - 120, y: c.y, wait: 16 });
  pinch.push({ type: "up", id: 51, kind: "touch", x: c.x + 120, y: c.y, wait: 10 });
  await gesture(pinch);
  await page.waitForTimeout(250);
  const z1 = await zoom();
  check(
    z1 !== z0 && (await undoTitle()) === undo0 && (await objects()) === before,
    `[sim] a two-finger pinch zooms (${z0} → ${z1}) and does not undo`,
  );
  await page.getByTitle(/^Fit artboard/).tap();
  await page.waitForTimeout(200);

  // 9. The menus work by tap: Select ▸ Select All, then Select ▸ Deselect.
  await menu("Select", /^Select All/);
  const all = await selected();
  await menu("Select", /^Deselect/);
  check(
    all === (await objects()) && (await selected()) === 0,
    `Select ▸ Select All and Deselect by tap (${all} selected)`,
  );

  // 10. The Text tool: a real tap places a title with "Text" selected (the tap focuses the hidden
  //     field — on the iPad, what raises the keyboard); typing replaces it; a tap on empty canvas
  //     ends editing and keeps it.
  await tapTool("Text");
  await tap(at(0.3, 0.75));
  await page.waitForTimeout(800);
  const focused = await page.evaluate(() => document.activeElement?.tagName === "TEXTAREA");
  await page.keyboard.type("Hello");
  await page.waitForTimeout(800);
  await tap(at(0.85, 0.15));
  const titled = await until(
    async () => (await page.getByText("Hello", { exact: true }).count()) > 0,
  );
  await page.screenshot({ path: `${OUT}/10-text.png` });
  check(
    focused && titled,
    "the Text tool's tap places a title and focuses it; typing replaces its text",
  );

  // 11. A radial gradient renders in WebKit (it is written under `gradientTransform` unless it is a
  //     circle): an ellipse on the artboard turned Radial, whose centre must differ from its rim.
  //     Two patches, not one image's range: a range also passes on an outline or the dark ground
  //     beyond the artboard, with no gradient at all.
  await tapTool("Ellipse");
  const e0 = at(0.5, 0.35);
  const [ew, eh] = [260, 160];
  await gesture(dragSteps("touch", 60, e0, { x: e0.x + ew, y: e0.y + eh }));
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Fill radial" }).tap();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/11-gradient.png` });
  const hasRadial = (await canvas.locator("radialGradient").count()) > 0;
  const brightness = async (x, y) => {
    const shot = await page.screenshot({ clip: { x: x - 5, y: y - 5, width: 10, height: 10 } });
    return page.evaluate(
      async (bytes) => {
        const bmp = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        );
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext("2d");
        g.drawImage(bmp, 0, 0);
        const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
        return sum / (d.length / 4);
      },
      [...shot],
    );
  };
  const [cx, cy] = [e0.x + ew / 2, e0.y + eh / 2];
  const centre = await brightness(cx, cy);
  const rim = await brightness(cx + (ew / 2) * 0.8, cy);
  check(
    hasRadial && Math.abs(rim - centre) > 20,
    `a radial gradient renders (brightness centre ${centre.toFixed(0)}, near the rim ${rim.toFixed(0)})`,
  );

  // 12. [sim] A Pencil stroke with the Brush that rests still for 0.7 s where it starts, then draws:
  //     it lands as one stroke, and the rest opens no context menu (review H1: armed for every
  //     tool, the long press cancelled a careful stroke and lost its ink — it only fires before the
  //     pointer moves 10 px, so the rest must come first). Lands asynchronously, through Paper.
  //     From here on a Pencil has been seen, so a finger only navigates.
  await tapTool("Brush");
  const objectsBeforeBrush = await objects();
  await gesture(
    dragSteps("pen", 2, at(0.2, 0.5), at(0.8, 0.55), {
      n: 40,
      hold: 700,
      p: (t) => 0.2 + 0.7 * Math.sin(t * Math.PI),
    }),
  );
  const stroked = await until(async () => (await objects()) === objectsBeforeBrush + 1);
  await page.screenshot({ path: `${OUT}/12-brush.png` });
  check(
    stroked && (await page.locator('[role="menu"]').count()) === 0,
    "[sim] a Pencil stroke with the Brush that rests first lands as one stroke, with no context menu",
  );

  // 13. [sim] After the Pencil, a finger drag on an object with the Select tool pans the view: the
  //     object moves on screen, but neither the document nor the selection changes.
  await tapTool("Select");
  await deselect();
  const p0 = await objectBox(0);
  const undo1 = await undoTitle();
  await gesture(dragSteps("touch", 70, { x: p0.cx, y: p0.cy }, { x: p0.cx + 80, y: p0.cy + 40 }));
  await page.waitForTimeout(200);
  const p1 = await objectBox(0);
  check(
    Math.abs(p1.x - p0.x - 80) < 2 &&
      Math.abs(p1.y - p0.y - 40) < 2 &&
      (await undoTitle()) === undo1 &&
      (await selected()) === 0,
    "[sim] after the Pencil, a finger drag pans the view and never moves or selects",
  );

  // 14. Fingers select (the dock toggle): on, a real finger tap selects after the Pencil; off, the
  //     same tap only navigates. The toggle itself is clicked, not tapped: the dock's buttons
  //     `preventDefault()` their pointerdown, and Playwright's touch emulation then makes no click
  //     (iOS still does — the toggle passed on the device, 2026-09-30). The canvas taps are real.
  const fingerToggle = page.getByRole("button", { name: "Fingers select", exact: true });
  const tapObject = async () => {
    const b = await objectBox(0);
    await tap({ x: b.cx, y: b.cy });
    await page.waitForTimeout(200);
    return selected();
  };
  const offPick = await tapObject();
  await fingerToggle.click();
  const onPick = await tapObject();
  await fingerToggle.click();
  await deselect();
  await page.screenshot({ path: `${OUT}/14-fingers-select.png` });
  check(
    offPick === 0 && onPick === 1 && (await fingerToggle.getAttribute("aria-pressed")) === "false",
    `after the Pencil, a finger tap selects only with Fingers select on (off ${offPick}, on ${onPick})`,
  );

  // 15. Rename by tapping the file name: Document settings, "Poster", Apply.
  await page.getByTitle(/rename in Document settings$/).tap();
  await page.getByTitle(/^Document name/).fill("Poster");
  await page.getByRole("button", { name: "Apply" }).tap();
  await page.waitForTimeout(200);
  const named = await page.getByTitle(/rename in Document settings$/).innerText();
  check(
    named.startsWith("Poster.svg"),
    `the file name opens Document settings and renames (${named})`,
  );

  // 16. File ▸ Save hands the share sheet (stubbed) Poster.svg — our own format, with the drawing —
  //     and marks the document saved.
  await menu("File", /^Save\b(?! As)/);
  const svg = await until(async () => (await shared()).find((f) => f.name === "Poster.svg"));
  const clean = await until(
    async () =>
      !(await page.getByTitle(/rename in Document settings$/).innerText()).includes("unsaved"),
  );
  check(
    !!svg && svg.text.includes("data-sv-version") && svg.text.includes("<rect") && clean,
    "File ▸ Save shares Poster.svg in our format and marks the document saved",
  );

  // 17. File ▸ Export PNG: a render outlasts the tap, so it goes through the "ready" dialog, whose
  //     own tap opens the share sheet (spec M13 §4).
  await menu("File", /^Export PNG/);
  await page.getByRole("button", { name: "Export", exact: true }).tap();
  const ready = page.getByRole("button", { name: "Save to Files…" });
  const readyShown = await until(async () => (await ready.count()) > 0, 10000);
  if (readyShown) await ready.tap();
  const png = await until(async () => (await shared()).find((f) => f.name === "Poster.png"));
  check(
    readyShown && !!png && png.type === "image/png" && png.size > 1000,
    `File ▸ Export PNG → the ready dialog → the share sheet gets Poster.png (${png?.size ?? 0} bytes)`,
  );

  // 18. File ▸ Import SVG… opens the file picker; the file's drawing joins the current layer.
  const objectsBeforeImport = await objects();
  const chooser = page.waitForEvent("filechooser");
  await menu("File", /^Import SVG/);
  await (
    await chooser
  ).setFiles({
    name: "dot.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" fill="#e33"/></svg>',
    ),
  });
  const imported = await until(async () => (await objects()) === objectsBeforeImport + 1);
  check(imported, "File ▸ Import SVG… opens the picker and adds the file's drawing");

  // 19. [sim] A finger drags the bottom object's row in the Layers panel by its grip to the top:
  //     mid-drag the row follows the finger and the rows below the drop point slide aside to open
  //     a gap; the lift reorders.
  const rowOrder = () =>
    page
      .locator("section[aria-label=Layers] [data-row-id]")
      .evaluateAll((els) => els.map((e) => e.dataset.rowId));
  const o0 = await rowOrder();
  const gripBox = await page
    .locator(`[data-row-id="${o0.at(-1)}"] button[aria-label^="Drag"]`)
    .boundingBox();
  const firstRow = await page.locator(`[data-row-id="${o0[1]}"]`).boundingBox();
  const from = { x: gripBox.x + gripBox.width / 2, y: gripBox.y + gripBox.height / 2 };
  const rowDrag = dragSteps("touch", 80, from, { x: from.x, y: firstRow.y + 6 });
  const rowLift = rowDrag.pop();
  await gesture(rowDrag);
  await page.waitForTimeout(200);
  const lifted = await page.evaluate(() => ({
    ghost: !!document.querySelector("[data-drag-ghost]"),
    gap: [...document.querySelectorAll("section[aria-label=Layers] [data-row-id]")].some(
      (e) => e.style.transform,
    ),
  }));
  await page.screenshot({ path: `${OUT}/19-layer-drag.png` });
  await gesture([rowLift]);
  await page.waitForTimeout(200);
  const o1 = await rowOrder();
  check(
    lifted.ghost && lifted.gap && o1[1] === o0.at(-1) && o1.length === o0.length,
    "[sim] a finger drags a layer row by its grip: it follows the finger, a gap opens, the drop reorders",
  );

  // 20. Autosave: a reload brings back the document and its name.
  const objectsBeforeReload = await objects();
  await page.waitForTimeout(3500); // the 3 s debounce
  await page.reload();
  await canvas.waitFor({ timeout: 20000 });
  const restored = await until(async () => (await objects()) === objectsBeforeReload);
  const nameKept = (await page.getByTitle(/rename in Document settings$/).innerText()).startsWith(
    "Poster.svg",
  );
  await page.screenshot({ path: `${OUT}/20-reloaded.png` });
  check(
    restored && nameKept,
    `a reload restores the autosaved document (${await objects()} of ${objectsBeforeReload} objects) and its name`,
  );

  // ---------------------------------------------------------------- portrait
  // 21. iPad portrait (834 px, below the 900 px breakpoint): the top bar fits without wrapping or
  //     overflowing, the File menu opens inside the window, and the Properties button opens the
  //     sidebar as a drawer.
  const portrait = await browser.newContext({ ...devices["iPad Pro 11"] });
  await portrait.addInitScript(pageSetup);
  const pp = await portrait.newPage();
  pp.on("pageerror", (e) => errors.push(`portrait: ${e.message}`));
  pp.on("console", (m) => m.type() === "error" && errors.push(`portrait: ${m.text()}`));
  await pp.goto(url);
  await pp.locator('[aria-label="Drawing canvas"]').waitFor({ timeout: 20000 });
  await pp.waitForTimeout(500);
  const bar = await pp
    .locator("header")
    .first()
    .evaluate((h) => ({ fits: h.scrollWidth <= h.clientWidth, height: h.offsetHeight }));
  await pp.getByRole("button", { name: /^File/ }).tap();
  const menuBox = await pp.locator('[role="menu"]').boundingBox();
  const vw = pp.viewportSize().width;
  const menuInside = !!menuBox && menuBox.x >= 0 && menuBox.x + menuBox.width <= vw;
  await pp.getByRole("button", { name: "Close menu" }).tap();
  const layersHidden = !(await pp.getByRole("region", { name: "Layers" }).isVisible());
  await pp.getByRole("button", { name: "Properties", exact: true }).tap();
  await pp.waitForTimeout(300);
  const drawer = await pp.getByRole("region", { name: "Layers" }).isVisible();
  await pp.screenshot({ path: `${OUT}/21-portrait.png` });
  check(
    bar.fits && bar.height === 44 && menuInside && layersHidden && drawer,
    `portrait: the top bar fits (${bar.height}px high), the File menu is on screen, Properties opens the sidebar drawer`,
  );

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
} finally {
  await browser.close();
  await server?.close();
}
console.log(
  failures.length ? `\n${failures.length} failed` : `\nall passed — screenshots in ${OUT}/`,
);
process.exit(failures.length ? 1 : 0);
