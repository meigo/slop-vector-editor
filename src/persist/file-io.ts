/** Open/save plain .svg files. Chromium desktop gets the File System Access API (save in place);
 *  everything else (iPad Safari, Firefox) opens through a file input and saves as a download. */

type PickerType = { description: string; accept: Record<string, string[]> };

declare global {
  interface Window {
    showOpenFilePicker?: (opts: { types: PickerType[] }) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (opts: {
      suggestedName: string;
      types: PickerType[];
    }) => Promise<FileSystemFileHandle>;
  }
}

const TYPES: PickerType[] = [{ description: "SVG image", accept: { "image/svg+xml": [".svg"] } }];

export type OpenedFile = { text: string; name: string; handle: FileSystemFileHandle | null };

const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

export async function pickSvgFile(): Promise<OpenedFile | null> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: TYPES });
      const file = await handle.getFile();
      return { text: await file.text(), name: file.name, handle };
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".svg,image/svg+xml";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
  return file ? { text: await file.text(), name: file.name, handle: null } : null;
}

async function writeTo(handle: FileSystemFileHandle, text: string): Promise<void> {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

export async function writeSvgFile(
  text: string,
  name: string,
  handle: FileSystemFileHandle | null,
  asNew: boolean,
): Promise<{ name: string; handle: FileSystemFileHandle | null } | null> {
  if (handle && !asNew) {
    await writeTo(handle, text);
    return { name: handle.name, handle };
  }
  if (window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: name, types: TYPES });
      await writeTo(h, text);
      return { name: h.name, handle: h };
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { name, handle: null };
}
