import { afterEach, describe, expect, it, vi } from "vitest";
import { routePointerDown, type RouteInput } from "../input/route";
import {
  DEFAULT_PREFS,
  loadPrefs,
  sanitizePrefs,
  savePrefs,
  type PrefStorage,
  type Prefs,
} from "../persist/preferences";
import { watchOtherTabs } from "../persist/tab-presence";
import { editActionForKey } from "../state/keys";

function memoryStorage(): PrefStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("preferences", () => {
  const custom: Prefs = {
    style: {
      fill: null,
      stroke: { color: "#ff0000", opacity: 0.5 },
      strokeWidth: 2.5,
      cap: "round",
      join: "bevel",
      opacity: 0.8,
    },
    polygon: { sides: 7, star: true, innerRatio: 0.3 },
    snap: false,
  };

  it("falls back to defaults for missing or malformed input", () => {
    expect(sanitizePrefs(undefined)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs("nope")).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs(custom)).toEqual(custom);
  });

  it("validates field by field", () => {
    const p = sanitizePrefs({
      style: {
        fill: { color: "red", opacity: 1 },
        stroke: null,
        strokeWidth: -1,
        cap: "x",
        join: "round",
        opacity: 2,
      },
      polygon: { sides: 2.5, star: "yes", innerRatio: 0.99 },
      snap: "yes",
    });
    expect(p.style).toEqual({
      fill: DEFAULT_PREFS.style.fill,
      stroke: null,
      strokeWidth: DEFAULT_PREFS.style.strokeWidth,
      cap: "butt",
      join: "round",
      opacity: 1,
    });
    expect(p.polygon).toEqual(DEFAULT_PREFS.polygon);
    expect(p.snap).toBe(true);
    const q = sanitizePrefs({ style: { fill: { color: "#00ff00", opacity: "x" } } });
    expect(q.style.fill).toEqual({ color: "#00ff00", opacity: 1 });
  });

  it("keeps a boolean snap preference", () => {
    expect(DEFAULT_PREFS.snap).toBe(true);
    expect(sanitizePrefs({ snap: false }).snap).toBe(false);
    expect(sanitizePrefs({}).snap).toBe(true);
  });

  it("loads and saves without ever throwing", () => {
    const s = memoryStorage();
    expect(loadPrefs(s)).toEqual(DEFAULT_PREFS);
    savePrefs(custom, s);
    expect(loadPrefs(s)).toEqual(custom);
    s.data.set("slop-vector-editor:prefs", "{not json");
    expect(loadPrefs(s)).toEqual(DEFAULT_PREFS);
    const broken: PrefStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(loadPrefs(broken)).toEqual(DEFAULT_PREFS);
    expect(() => savePrefs(custom, broken)).not.toThrow();
    expect(loadPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(() => savePrefs(custom, null)).not.toThrow();
  });
});

describe("routePointerDown", () => {
  const base: RouteInput = {
    pointerType: "mouse",
    button: 0,
    activePointers: 0,
    activeTouches: 0,
    spaceHeld: false,
    tool: "select",
    pencilSeen: false,
    penActive: false,
  };
  const r = (over: Partial<RouteInput>) => routePointerDown({ ...base, ...over });

  it("routes mouse buttons", () => {
    expect(r({})).toBe("tool");
    expect(r({ button: 2 })).toBe("menu");
    expect(r({ button: 1 })).toBe("pan");
    expect(r({ button: 3 })).toBe("ignore");
    expect(r({ activePointers: 1 })).toBe("ignore");
    expect(r({ button: 1, activePointers: 1 })).toBe("ignore");
  });

  it("pans with Space or the Hand tool", () => {
    expect(r({ spaceHeld: true })).toBe("pan");
    expect(r({ tool: "hand" })).toBe("pan");
    expect(r({ pointerType: "pen", spaceHeld: true })).toBe("pan");
  });

  it("routes touch and pen", () => {
    expect(r({ pointerType: "touch" })).toBe("tool");
    expect(r({ pointerType: "touch", pencilSeen: true })).toBe("pan");
    expect(r({ pointerType: "touch", activePointers: 1, activeTouches: 1 })).toBe("pinch");
    expect(r({ pointerType: "touch", activePointers: 1, activeTouches: 1, pencilSeen: true })).toBe(
      "pinch",
    );
    expect(r({ pointerType: "pen", pencilSeen: true })).toBe("tool");
    expect(r({ pointerType: "pen", activePointers: 1 })).toBe("ignore");
    expect(r({ pointerType: "touch", activePointers: 1, activeTouches: 0 })).toBe("ignore");
  });

  it("lets a Pencil take over from fingers already down", () => {
    // A palm (or a whole resting hand) landed first and started a pan or a pinch.
    expect(r({ pointerType: "pen", activePointers: 1, activeTouches: 1 })).toBe("tool");
    expect(r({ pointerType: "pen", activePointers: 2, activeTouches: 2 })).toBe("tool");
    expect(r({ pointerType: "pen", activePointers: 3, activeTouches: 3 })).toBe("tool");
  });

  it("still routes a taking-over Pencil by the tool and the space key", () => {
    expect(r({ pointerType: "pen", activePointers: 1, activeTouches: 1, tool: "hand" })).toBe(
      "pan",
    );
    expect(r({ pointerType: "pen", activePointers: 1, activeTouches: 1, spaceHeld: true })).toBe(
      "pan",
    );
  });

  it("does not let a pen take over from another pen or a mouse", () => {
    expect(r({ pointerType: "pen", activePointers: 1, activeTouches: 0 })).toBe("ignore");
    expect(r({ pointerType: "pen", activePointers: 2, activeTouches: 1 })).toBe("ignore");
  });

  it("ignores a finger while a pen or mouse gesture is running", () => {
    // Without penActive this would start a pinch — a palm landing beside the Pencil (spec M5 §2).
    expect(r({ pointerType: "touch", activePointers: 1, activeTouches: 1, penActive: true })).toBe(
      "ignore",
    );
    expect(r({ pointerType: "touch", activePointers: 1, activeTouches: 0, penActive: true })).toBe(
      "ignore",
    );
  });
});

describe("editActionForKey", () => {
  const k = (
    key: string,
    mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; code: string }> = {},
  ) => editActionForKey({ key, metaKey: false, ctrlKey: false, shiftKey: false, ...mods });

  it("maps tool keys without modifiers", () => {
    expect(k("v")).toEqual({ kind: "tool", tool: "select" });
    expect(k("R")).toEqual({ kind: "tool", tool: "rect" });
    expect(k("e")).toEqual({ kind: "tool", tool: "ellipse" });
    expect(k("l")).toEqual({ kind: "tool", tool: "line" });
    expect(k("y")).toEqual({ kind: "tool", tool: "polygon" });
    expect(k("p")).toEqual({ kind: "tool", tool: "pen" });
    expect(k("h")).toEqual({ kind: "tool", tool: "hand" });
    expect(k("n")).toEqual({ kind: "tool", tool: "node" });
    expect(k("v", { shiftKey: true })).toBeNull();
    expect(k("x")).toBeNull();
  });

  it("maps editing keys", () => {
    expect(k("Delete")).toEqual({ kind: "delete" });
    expect(k("Backspace")).toEqual({ kind: "delete" });
    expect(k("Escape")).toEqual({ kind: "clear" });
    expect(k("d", { metaKey: true })).toEqual({ kind: "duplicate" });
    expect(k("d", { ctrlKey: true })).toEqual({ kind: "duplicate" });
    expect(k("v", { metaKey: true })).toBeNull();
    expect(k("ArrowLeft")).toEqual({ kind: "nudge", dx: -1, dy: 0 });
    expect(k("ArrowDown", { shiftKey: true })).toEqual({ kind: "nudge", dx: 0, dy: 10 });
    expect(k("ArrowUp")).toEqual({ kind: "nudge", dx: 0, dy: -1 });
    expect(k("ArrowRight", { shiftKey: true })).toEqual({ kind: "nudge", dx: 10, dy: 0 });
    expect(k("%", { shiftKey: true })).toEqual({ kind: "toggleSnap" });
    expect(k("%", { metaKey: true })).toBeNull();
  });

  it("maps bracket keys with a modifier to z-order", () => {
    expect(k("]", { metaKey: true, code: "BracketRight" })).toEqual({
      kind: "zorder",
      op: "forward",
    });
    expect(k("}", { metaKey: true, shiftKey: true, code: "BracketRight" })).toEqual({
      kind: "zorder",
      op: "front",
    });
    expect(k("[", { ctrlKey: true, code: "BracketLeft" })).toEqual({
      kind: "zorder",
      op: "backward",
    });
    expect(k("{", { ctrlKey: true, shiftKey: true, code: "BracketLeft" })).toEqual({
      kind: "zorder",
      op: "back",
    });
    expect(k("]", { code: "BracketRight" })).toBeNull();
    expect(k("x", { metaKey: true, code: "KeyX" })).toBeNull();
  });

  it("maps the group shortcuts", () => {
    expect(k("g", { metaKey: true })).toEqual({ kind: "group" });
    expect(k("g", { metaKey: true, shiftKey: true })).toEqual({ kind: "ungroup" });
    expect(k("g", { ctrlKey: true })).toEqual({ kind: "group" });
    expect(k("g")).toBeNull();
  });

  it("maps Enter to commit", () => {
    expect(k("Enter")).toEqual({ kind: "commit" });
    expect(k("Enter", { metaKey: true })).toBeNull();
  });

  it("maps the selection shortcuts", () => {
    expect(k("a", { metaKey: true })).toEqual({ kind: "selectAll" });
    expect(k("a", { metaKey: true, shiftKey: true })).toEqual({ kind: "invertSelection" });
    expect(k("a", { ctrlKey: true })).toEqual({ kind: "selectAll" });
    // A bare "a" is not a tool key and must stay unhandled.
    expect(k("a")).toBeNull();
  });
});

describe("watchOtherTabs", () => {
  afterEach(() => vi.unstubAllGlobals());
  const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("tells both tabs once when a second tab appears", async () => {
    const name = `test-${Math.random()}`;
    let a = 0;
    let b = 0;
    const stopA = watchOtherTabs(() => a++, name);
    await tick(30);
    expect(a).toBe(0);
    const stopB = watchOtherTabs(() => b++, name);
    await tick(60);
    expect(a).toBe(1);
    expect(b).toBe(1);
    const stopC = watchOtherTabs(() => undefined, name);
    await tick(60);
    expect(a).toBe(1);
    expect(b).toBe(1);
    stopA();
    stopB();
    stopC();
  });

  it("does nothing without BroadcastChannel", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const stop = watchOtherTabs(() => {
      throw new Error("should not be called");
    });
    expect(() => stop()).not.toThrow();
  });
});
