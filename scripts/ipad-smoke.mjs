// iPad smoke check (`npm run test:ipad`): the app in WebKit — Safari's engine — at iPad Pro 11
// landscape size with touch, in a fresh profile (its own IndexedDB and localStorage: never your
// autosave). Ported from slop-paint's `tools/ipad-smoke.mjs` (2026-10-01).
//
//   npm run test:ipad                     starts its own dev server on a free port
//   npm run test:ipad -- <url>            checks that URL instead (e.g. the deployed site)
//
// Screenshots go to test-results/ipad/. Exits 1 when a check fails or the page reports an error.
// Not covered — test these on the iPad itself (docs/superpowers/IPAD-CHECKLIST.md): the real
// Pencil (strokes here are simulated pen events), multi-finger gestures, the share sheet, the
// on-screen keyboard, iPadOS memory limits.
// First run on a machine: `npx playwright install webkit` (~100 MB).
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

const browser = await webkit.launch();
try {
  const context = await browser.newContext({ ...devices["iPad Pro 11 landscape"] });
  // Simulated pen events aren't live pointers, so WebKit refuses to capture them ("The object
  // can not be found here"); a real Pencil is one. Let capture fail quietly for the simulation.
  await context.addInitScript(() => {
    const capture = Element.prototype.setPointerCapture;
    Element.prototype.setPointerCapture = function (id) {
      try {
        capture.call(this, id);
      } catch {
        /* simulated pointer */
      }
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  const canvas = page.locator('[aria-label="Drawing canvas"]');
  const undoTitle = () =>
    page.getByRole("button", { name: "Undo", exact: true }).getAttribute("title");
  const width = async () => Number(await page.getByLabel("W", { exact: true }).inputValue());

  // 1. Loads.
  await page.goto(url);
  await canvas.waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/1-loaded.png` });
  check(true, `loads (${url})`);

  // 2. A real touch tap opens the File menu.
  const file = await page.getByRole("button", { name: /^File/ }).boundingBox();
  await page.touchscreen.tap(file.x + file.width / 2, file.y + file.height / 2);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/2-menu.png` });
  const opened = (await page.locator('[role="menu"]').count()) > 0;
  // A tap outside closes it, as on the iPad (there is no Escape there; Escape is parked keyboard work).
  const hb = await canvas.boundingBox();
  const at = (fx, fy) => ({ x: hb.x + hb.width * fx, y: hb.y + hb.height * fy });
  await page.touchscreen.tap(at(0.9, 0.9).x, at(0.9, 0.9).y);
  await page.waitForTimeout(300);
  const closed = (await page.locator('[role="menu"]').count()) === 0;
  check(opened && closed, "a finger tap opens the File menu, and a tap outside closes it");

  // 3. A Pencil stroke with the Brush: pen pointer events with rising and falling pressure. The
  //    stroke lands asynchronously (simplified through the lazily loaded Paper chunk).
  await page.keyboard.press("b");
  await canvas.evaluate(
    (host, { x0, x1, y }) => {
      const target = document.elementFromPoint((x0 + x1) / 2, y) ?? host;
      const send = (type, t) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 2,
            pointerType: "pen",
            isPrimary: true,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: x0 + (x1 - x0) * t,
            clientY: y + 30 * Math.sin(t * Math.PI),
            pressure: 0.2 + 0.7 * Math.sin(t * Math.PI),
          }),
        );
      send("pointerdown", 0);
      for (let i = 1; i <= 40; i++) send("pointermove", i / 40);
      send("pointerup", 1);
    },
    { x0: at(0.2, 0).x, x1: at(0.8, 0).x, y: at(0, 0.5).y },
  );
  const stroked = await until(async () => !/nothing to undo/.test((await undoTitle()) ?? ""));
  await page.screenshot({ path: `${OUT}/3-brush.png` });
  check(stroked, "a pen stroke with the Brush lands and adds an undo step");

  // 4. A thin rectangle's corner drag scales it uniformly by the pointer's travel along its
  //    diagonal (review M14): a 6 px nudge on the short side once made it 1.25× as long.
  await page.keyboard.press("r");
  const r0 = at(0.15, 0.2);
  await page.mouse.move(r0.x, r0.y);
  await page.mouse.down();
  await page.mouse.move(r0.x + 300, r0.y + 24, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("v");
  await page.waitForTimeout(300);
  const w0 = await width();
  await page.mouse.move(r0.x + 300, r0.y + 24);
  await page.mouse.down();
  await page.mouse.move(r0.x + 306, r0.y + 30, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const w1 = await width();
  await page.screenshot({ path: `${OUT}/4-corner.png` });
  check(
    w1 > w0 && w1 / w0 < 1.1,
    `a thin rectangle's corner drag scales by the drag, not the short side (W ${w0} → ${w1})`,
  );

  // 5. The Text tool places a title with "Text" selected; typing replaces it; Escape commits.
  await page.keyboard.press("t");
  const t0 = at(0.3, 0.75);
  await page.mouse.click(t0.x, t0.y);
  await page.waitForTimeout(800);
  await page.keyboard.type("Hello");
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
  const titled = await until(
    async () => (await page.getByText("Hello", { exact: true }).count()) > 0,
  );
  await page.screenshot({ path: `${OUT}/5-text.png` });
  check(titled, "the Text tool places a title, and typing replaces its text");

  // 6. A radial gradient renders in WebKit (it is written under `gradientTransform` unless it is a
  //    circle): an ellipse on the artboard turned Radial, whose centre must differ from its rim. Two
  //    patches, not one image's range: a range also passes on an outline or the dark ground beyond
  //    the artboard, with no gradient at all.
  await page.keyboard.press("e");
  const e0 = at(0.5, 0.35);
  const [ew, eh] = [260, 160];
  await page.mouse.move(e0.x, e0.y);
  await page.mouse.down();
  await page.mouse.move(e0.x + ew, e0.y + eh, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Fill radial" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/6-gradient.png` });
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

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
} finally {
  await browser.close();
  await server?.close();
}
console.log(
  failures.length ? `\n${failures.length} failed` : `\nall passed — screenshots in ${OUT}/`,
);
process.exit(failures.length ? 1 : 0);
