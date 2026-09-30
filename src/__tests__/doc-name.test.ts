import { describe, expect, it } from "vitest";
import { createDoc } from "../doc/document";
import { app, markDocSaved, renameDocument, replaceDocument } from "../state/appState.svelte";
import { baseName, svgFileName } from "../state/doc-name";

describe("document name", () => {
  it("adds the .svg extension, once", () => {
    expect(svgFileName("Poster")).toBe("Poster.svg");
    expect(svgFileName("Poster.svg")).toBe("Poster.svg");
    expect(svgFileName("Poster.SVG")).toBe("Poster.svg");
  });

  it("trims, drops characters a file name can't hold, and falls back to Untitled", () => {
    expect(svgFileName("  a/b:c*d?  ")).toBe("abcd.svg");
    expect(svgFileName('<x>|"y"\\')).toBe("xy.svg");
    expect(svgFileName("")).toBe("Untitled.svg");
    expect(svgFileName("   ")).toBe("Untitled.svg");
    expect(svgFileName("/:*")).toBe("Untitled.svg");
    expect(svgFileName(".svg")).toBe("Untitled.svg");
  });

  it("baseName is what the field shows", () => {
    expect(baseName("Poster.svg")).toBe("Poster");
    expect(baseName("Untitled.svg")).toBe("Untitled");
    expect(baseName("notes.txt")).toBe("notes.txt");
  });
});

describe("renameDocument", () => {
  const handle = { name: "Old.svg" } as unknown as FileSystemFileHandle;

  it("sets the name and drops the save-in-place link; the drawing stays clean", () => {
    replaceDocument(createDoc(100, 100), "Old.svg", handle, true);
    const session = app.session;
    renameDocument("New");
    expect(app.fileName).toBe("New.svg");
    expect(app.fileHandle).toBeNull();
    expect(app.session).toBe(session);
    expect(app.dirty).toBe(false);
  });

  it("an unchanged name keeps the link", () => {
    replaceDocument(createDoc(100, 100), "Old.svg", handle, true);
    renameDocument(" Old ");
    expect(app.fileHandle).toBe(handle);
    markDocSaved(app.doc, "Old.svg", handle);
    expect(app.fileName).toBe("Old.svg");
  });
});
