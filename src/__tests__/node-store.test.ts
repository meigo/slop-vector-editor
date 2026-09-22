import { beforeEach, describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type Node,
  type PathNode,
  type PathShape,
} from "../doc/document";
import { findNode, mapNodes } from "../doc/tree";
import { applyMat, IDENTITY } from "../geom/mat";
import {
  app,
  clearOrLeaveGroup,
  commitDoc,
  deleteSelectedNodes,
  invertSelection,
  nudgeSelection,
  redo,
  replaceDocument,
  reverseSelectionDirection,
  selectAll,
  selectSame,
  setEnteredGroup,
  setNodeSel,
  setNodeTarget,
  setSelection,
  setTool,
  subdivideSelectionNodes,
  toggleLayerLocked,
  toggleLayerVisible,
  toggleNodeLocked,
  undo,
} from "../state/appState.svelte";
import { runEditAction } from "../state/commands";
import { TOOLS } from "../tools/registry";
import type { Tool } from "../tools/tool";

/** Real-store coverage for the M4a node-editing state: `setSession`'s node re-resolution, the
 *  Escape chain, `runEditAction`'s routing, and `deleteSelectedNodes`. Drives the store through
 *  its own exported actions and resets it before each test so nothing leaks between them. */

const node = (x: number, y: number): PathNode => ({
  p: { x, y },
  in: null,
  out: null,
  type: "corner",
});

const rect = (id: string, x: number, y: number, w: number, h: number): Node => ({
  kind: "rect",
  id,
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  x,
  y,
  w,
  h,
  rx: 0,
});

/** A 3-node path "p" and a rect "r", both on layer "L0". */
function makeDoc(): Doc {
  return {
    ...createDoc(100, 100),
    layers: [
      {
        id: "L0",
        name: "L0",
        visible: true,
        locked: false,
        children: [
          {
            kind: "path",
            id: "p",
            transform: IDENTITY,
            style: DEFAULT_STYLE,
            subpaths: [{ closed: false, nodes: [node(0, 0), node(10, 0), node(10, 10)] }],
          } as Node,
          rect("r", 40, 40, 10, 10),
        ],
      },
    ],
  };
}

/** A top-level group "g" containing rect "b", for the Escape/entered-group tests. */
function makeGroupDoc(): Doc {
  return {
    ...createDoc(100, 100),
    layers: [
      {
        id: "L0",
        name: "L0",
        visible: true,
        locked: false,
        children: [
          {
            kind: "group",
            id: "g",
            transform: IDENTITY,
            opacity: 1,
            children: [rect("b", 0, 0, 10, 10)],
          },
        ],
      },
    ],
  };
}

function pathNodeCount(): number {
  const found = findNode(app.doc, "p");
  return found && found.node.kind === "path" ? found.node.subpaths[0].nodes.length : -1;
}

beforeEach(() => {
  replaceDocument(makeDoc(), "Untitled.svg", null, true);
  setTool("select");
});

describe("setSession node re-resolution", () => {
  it("clears the node target and selection when its path is deleted", () => {
    setNodeTarget("p");
    setNodeSel([{ sub: 0, i: 0 }]);
    setSelection(["p"]);
    runEditAction({ kind: "delete" });
    expect(findNode(app.doc, "p")).toBeNull();
    expect(app.nodeTarget).toBeNull();
    expect(app.nodeSel).toEqual([]);
  });

  it("clears the node target when its layer is hidden", () => {
    setNodeTarget("p");
    setNodeSel([{ sub: 0, i: 0 }]);
    toggleLayerVisible("L0");
    expect(app.nodeTarget).toBeNull();
    expect(app.nodeSel).toEqual([]);
  });

  it("clears the node target when its layer is locked", () => {
    setNodeTarget("p");
    setNodeSel([{ sub: 0, i: 0 }]);
    toggleLayerLocked("L0");
    expect(app.nodeTarget).toBeNull();
    expect(app.nodeSel).toEqual([]);
  });

  it("clears the node target when the path itself is locked", () => {
    setNodeTarget("p");
    setNodeSel([{ sub: 0, i: 0 }]);
    toggleNodeLocked("p");
    expect(app.nodeTarget).toBeNull();
    expect(app.nodeSel).toEqual([]);
  });

  it("prunes stale nodeSel refs beyond the current node count", () => {
    setNodeTarget("p");
    setNodeSel([
      { sub: 0, i: 0 },
      { sub: 0, i: 2 },
    ]);
    const path = findNode(app.doc, "p")!.node as PathShape;
    const shorter: PathShape = {
      ...path,
      subpaths: [{ ...path.subpaths[0], nodes: path.subpaths[0].nodes.slice(0, 2) }],
    };
    commitDoc(mapNodes(app.doc, ["p"], () => shorter));
    expect(app.nodeTarget).toBe("p");
    expect(app.nodeSel).toEqual([{ sub: 0, i: 0 }]);
  });

  it("keeps the node target across an unrelated edit", () => {
    setNodeTarget("p");
    setNodeSel([{ sub: 0, i: 1 }]);
    setSelection(["r"]);
    nudgeSelection(5, 0);
    expect(app.nodeTarget).toBe("p");
    expect(app.nodeSel).toEqual([{ sub: 0, i: 1 }]);
  });
});

describe("Escape (clearOrLeaveGroup)", () => {
  it("with the node tool active, clears the node selection first, then the target", () => {
    setTool("node");
    setNodeTarget("p");
    setNodeSel([{ sub: 0, i: 0 }]);

    clearOrLeaveGroup();
    expect(app.nodeSel).toEqual([]);
    expect(app.nodeTarget).toBe("p");
    expect(app.toolId).toBe("node");

    clearOrLeaveGroup();
    expect(app.nodeTarget).toBeNull();
    expect(app.toolId).toBe("select");
  });

  it("with no node state, falls through to the entered group and then the selection", () => {
    replaceDocument(makeGroupDoc(), "Untitled.svg", null, true);
    setTool("select");
    setEnteredGroup("g");
    setSelection(["b"]);

    clearOrLeaveGroup();
    expect(app.enteredGroupId).toBeNull();
    expect(app.selection).toEqual(["g"]);

    clearOrLeaveGroup();
    expect(app.selection).toEqual([]);
  });
});

describe("runEditAction routing", () => {
  it("routes Delete to the node action only when the node tool is active with a node selection", () => {
    setSelection(["p"]);
    setTool("node");
    setNodeTarget("p");
    setNodeSel([{ sub: 0, i: 0 }]);
    runEditAction({ kind: "delete" });
    expect(pathNodeCount()).toBe(2);
    expect(app.selection).toEqual(["p"]);
    expect(app.nodeSel).toEqual([]);
  });

  it("routes Delete to the object action when the node tool is not active", () => {
    setSelection(["r"]);
    setTool("select");
    runEditAction({ kind: "delete" });
    expect(findNode(app.doc, "r")).toBeNull();
  });

  it("routes Delete to the object action when the node tool is active but nothing is node-selected", () => {
    setTool("node");
    setNodeTarget("p");
    setNodeSel([]);
    setSelection(["r"]);
    runEditAction({ kind: "delete" });
    expect(findNode(app.doc, "r")).toBeNull();
  });

  it("routes a nudge to the node action only when the node tool is active with a node selection", () => {
    setTool("node");
    setNodeTarget("p");
    setNodeSel([{ sub: 0, i: 0 }]);
    runEditAction({ kind: "nudge", dx: 1, dy: 2 });
    const path = findNode(app.doc, "p")!.node as PathShape;
    expect(path.subpaths[0].nodes[0].p).toEqual({ x: 1, y: 2 });
  });

  it("routes a nudge to the object action otherwise", () => {
    setTool("select");
    setSelection(["r"]);
    runEditAction({ kind: "nudge", dx: 1, dy: 2 });
    const r = findNode(app.doc, "r")!.node;
    expect(r.kind === "rect" ? applyMat(r.transform, { x: r.x, y: r.y }) : null).toEqual({
      x: 41,
      y: 42,
    });
  });
});

describe("keys reach the active tool", () => {
  /** Swaps the registry's select entry for a stub, so the store's routing can be driven directly. */
  function withStub(stub: Tool, run: () => void): void {
    const registry = TOOLS as Record<string, Tool>;
    const original = registry.select;
    registry.select = stub;
    try {
      run();
    } finally {
      registry.select = original;
    }
  }

  it("lets a busy tool consume Escape, Enter and Backspace", () => {
    const seen: string[] = [];
    const stub: Tool = {
      ...TOOLS.select,
      busy: () => true,
      keydown: (_ctx, key) => {
        seen.push(key);
        return true;
      },
    };
    withStub(stub, () => {
      setNodeTarget("p");
      setNodeSel([{ sub: 0, i: 0 }]);
      setEnteredGroup(null);
      runEditAction({ kind: "clear" });
      runEditAction({ kind: "commit" });
      runEditAction({ kind: "delete" });
    });
    expect(seen).toEqual(["escape", "enter", "backspace"]);
    // Nothing else ran: the node target and its selection are untouched.
    expect(app.nodeTarget).toBe("p");
    expect(app.nodeSel).toEqual([{ sub: 0, i: 0 }]);
  });

  it("falls through to the store when the tool is not busy", () => {
    const stub: Tool = {
      ...TOOLS.select,
      busy: () => false,
      keydown: () => true,
    };
    withStub(stub, () => {
      setSelection(["r"]);
      runEditAction({ kind: "delete" });
    });
    expect(findNode(app.doc, "r")).toBeNull();
  });

  it("ignores commit for a tool with no keydown", () => {
    setSelection(["r"]);
    runEditAction({ kind: "commit" });
    expect(app.selection).toEqual(["r"]);
  });

  it("reports whether Enter was consumed, so App.svelte only cancels a key it used", () => {
    // Enter with no busy tool must keep activating the focused button.
    expect(runEditAction({ kind: "commit" })).toBe(false);
    const stub: Tool = { ...TOOLS.select, busy: () => true, keydown: () => true };
    withStub(stub, () => {
      expect(runEditAction({ kind: "commit" })).toBe(true);
    });
    // Every other editing key is the app's own.
    expect(runEditAction({ kind: "clear" })).toBe(true);
    expect(runEditAction({ kind: "toggleSnap" })).toBe(true);
    runEditAction({ kind: "toggleSnap" });
  });

  it("drops a tool's draft when the whole document changes", () => {
    const dropped: string[] = [];
    const stub: Tool = {
      ...TOOLS.select,
      busy: () => true,
      discard: () => {
        dropped.push(app.toolId);
      },
    };
    withStub(stub, () => {
      replaceDocument(makeDoc(), "Untitled.svg", null, true);
      setSelection(["r"]);
      runEditAction({ kind: "delete" });
      undo();
      redo();
    });
    // A draft was built on a document all three of these throw away (spec M4b §2).
    expect(dropped).toEqual(["select", "select", "select"]);
  });

  it("keeps the draft when there is nothing to undo or redo", () => {
    const dropped: string[] = [];
    const stub: Tool = {
      ...TOOLS.select,
      busy: () => true,
      discard: () => {
        dropped.push(app.toolId);
      },
    };
    withStub(stub, () => {
      replaceDocument(makeDoc(), "Untitled.svg", null, true);
      dropped.length = 0;
      // Both stacks are empty, so neither key changes the document — and a stroke in progress is
      // not a thing to throw away.
      undo();
      redo();
    });
    expect(dropped).toEqual([]);
  });
});

describe("deleteSelectedNodes", () => {
  it("removes the whole path when its last nodes go, and clears the target", () => {
    setNodeTarget("p");
    setNodeSel([
      { sub: 0, i: 0 },
      { sub: 0, i: 1 },
      { sub: 0, i: 2 },
    ]);
    deleteSelectedNodes();
    expect(findNode(app.doc, "p")).toBeNull();
    expect(app.nodeTarget).toBeNull();
    expect(app.nodeSel).toEqual([]);
  });

  it("keeps the path and target when nodes remain", () => {
    setNodeTarget("p");
    setNodeSel([{ sub: 0, i: 0 }]);
    deleteSelectedNodes();
    expect(pathNodeCount()).toBe(2);
    expect(app.nodeTarget).toBe("p");
    expect(app.nodeSel).toEqual([]);
  });
});

describe("path operations clear a stale node selection", () => {
  // Both operations renumber a subpath's nodes (subdivide: i -> 2i; reverse: order inverted), so
  // a node selection surviving in range would silently land on a different node than the one the
  // user picked.
  it("clears the node selection after subdivide", () => {
    setSelection(["p"]);
    setTool("node");
    setNodeTarget("p");
    setNodeSel([{ sub: 0, i: 1 }]);
    subdivideSelectionNodes();
    expect(app.nodeSel).toEqual([]);
    expect(app.nodeTarget).toBe("p");
  });

  it("clears the node selection after reverse direction", () => {
    setSelection(["p"]);
    setTool("node");
    setNodeTarget("p");
    setNodeSel([{ sub: 0, i: 1 }]);
    reverseSelectionDirection();
    expect(app.nodeSel).toEqual([]);
    expect(app.nodeTarget).toBe("p");
  });
});

describe("selection commands", () => {
  it("selects everything, then inverts it", () => {
    selectAll();
    expect(app.selection).toEqual(["p", "r"]);
    invertSelection();
    expect(app.selection).toEqual([]);
    invertSelection();
    expect(app.selection).toEqual(["p", "r"]);
  });

  it("selects the same kind", () => {
    setSelection(["r"]);
    selectSame("kind");
    expect(app.selection).toEqual(["r"]);
    setSelection(["p"]);
    selectSame("kind");
    expect(app.selection).toEqual(["p"]);
  });

  // The reach rule itself is covered in select-match.test.ts, whose fixture has hidden and locked
  // layers; this fixture has one layer, so hiding it only proves the selection clears.
  it("selects the same fill, and clears when its layer is hidden", () => {
    setSelection(["p"]);
    selectSame("fill");
    // p and r share DEFAULT_STYLE, so both match.
    expect(app.selection).toEqual(["p", "r"]);
    toggleLayerVisible("L0");
    selectAll();
    expect(app.selection).toEqual([]);
  });

  it("routes the two shortcuts through runEditAction", () => {
    setSelection([]);
    runEditAction({ kind: "selectAll" });
    expect(app.selection).toEqual(["p", "r"]);
    runEditAction({ kind: "invertSelection" });
    expect(app.selection).toEqual([]);
  });
});
