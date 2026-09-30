import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLongPress, LONG_PRESS_MS, LONG_PRESS_SLOP } from "../input/long-press";

describe("long press (touch and Pencil context menu)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const fired: { x: number; y: number }[] = [];
    const lp = createLongPress((at) => fired.push(at));
    return { lp, fired };
  };

  it("fires after the hold time at the press point", () => {
    const { lp, fired } = setup();
    lp.start(1, { x: 10, y: 20 });
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fired).toEqual([{ x: 10, y: 20 }]);
  });

  it("tolerates a trembling finger, but not a move past the slop", () => {
    const { lp, fired } = setup();
    lp.start(1, { x: 0, y: 0 });
    lp.move(1, { x: LONG_PRESS_SLOP, y: 0 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(fired).toHaveLength(1);
    lp.start(2, { x: 0, y: 0 });
    lp.move(2, { x: 0, y: LONG_PRESS_SLOP + 1 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(fired).toHaveLength(1);
  });

  it("is cancelled by lifting, by cancel, and ignores other pointers' moves", () => {
    const { lp, fired } = setup();
    lp.start(1, { x: 0, y: 0 });
    lp.end(1);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    lp.start(2, { x: 0, y: 0 });
    lp.cancel();
    vi.advanceTimersByTime(LONG_PRESS_MS);
    lp.start(3, { x: 0, y: 0 });
    lp.move(4, { x: 500, y: 500 });
    lp.end(4);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(fired).toEqual([{ x: 0, y: 0 }]);
  });

  it("a new press replaces a pending one", () => {
    const { lp, fired } = setup();
    lp.start(1, { x: 0, y: 0 });
    vi.advanceTimersByTime(LONG_PRESS_MS / 2);
    lp.start(2, { x: 5, y: 5 });
    vi.advanceTimersByTime(LONG_PRESS_MS / 2);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(LONG_PRESS_MS / 2);
    expect(fired).toEqual([{ x: 5, y: 5 }]);
  });
});
