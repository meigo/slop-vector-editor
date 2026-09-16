/** A deliberately small XML reader for SVG files. Runs identically in node (tests) and the
 *  browser. No namespaces processing: prefixed names are kept verbatim. */

export type XmlElement = {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
};

export class XmlError extends Error {}

const NAME_RE = /[A-Za-z_:][-\w.:]*/y;
const ATTR_NAME_RE = /[^\s=/>]+/y;

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e]!;
  });
}

export function parseXml(src: string): XmlElement {
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let i = 0;

  const indexOrThrow = (needle: string, from: number, what: string) => {
    const at = src.indexOf(needle, from);
    if (at < 0) throw new XmlError(`Unterminated ${what}`);
    return at;
  };
  const addText = (t: string) => {
    if (stack.length) stack[stack.length - 1].text += t;
  };
  const skipWs = (j: number) => {
    while (j < src.length && /\s/.test(src[j])) j++;
    return j;
  };

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      addText(decode(src.slice(i)));
      break;
    }
    if (lt > i) addText(decode(src.slice(i, lt)));

    if (src.startsWith("<!--", lt)) {
      i = indexOrThrow("-->", lt + 4, "comment") + 3;
    } else if (src.startsWith("<![CDATA[", lt)) {
      const end = indexOrThrow("]]>", lt + 9, "CDATA section");
      addText(src.slice(lt + 9, end));
      i = end + 3;
    } else if (src.startsWith("<?", lt)) {
      i = indexOrThrow("?>", lt + 2, "processing instruction") + 2;
    } else if (src.startsWith("<!", lt)) {
      let j = lt + 2;
      let depth = 0;
      for (; j < src.length; j++) {
        const c = src[j];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth === 0) break;
      }
      if (j >= src.length) throw new XmlError("Unterminated declaration");
      i = j + 1;
    } else if (src[lt + 1] === "/") {
      const end = indexOrThrow(">", lt, "end tag");
      const name = src.slice(lt + 2, end).trim();
      const top = stack.pop();
      if (!top || top.name !== name) throw new XmlError(`Unexpected </${name}>`);
      i = end + 1;
    } else {
      NAME_RE.lastIndex = lt + 1;
      const m = NAME_RE.exec(src);
      if (!m) throw new XmlError(`Invalid tag at ${lt}`);
      const el: XmlElement = { name: m[0], attrs: {}, children: [], text: "" };
      let j = NAME_RE.lastIndex;
      let selfClosing = false;
      for (;;) {
        j = skipWs(j);
        if (j >= src.length) throw new XmlError(`Unterminated <${el.name}>`);
        if (src.startsWith("/>", j)) {
          selfClosing = true;
          j += 2;
          break;
        }
        if (src[j] === ">") {
          j++;
          break;
        }
        ATTR_NAME_RE.lastIndex = j;
        const a = ATTR_NAME_RE.exec(src);
        if (!a) throw new XmlError(`Invalid attribute in <${el.name}>`);
        j = skipWs(ATTR_NAME_RE.lastIndex);
        if (src[j] !== "=") throw new XmlError(`Attribute ${a[0]} has no value`);
        j = skipWs(j + 1);
        const quote = src[j];
        if (quote !== '"' && quote !== "'") throw new XmlError(`Unquoted attribute ${a[0]}`);
        const end = indexOrThrow(quote, j + 1, `attribute ${a[0]}`);
        el.attrs[a[0]] = decode(src.slice(j + 1, end));
        j = end + 1;
      }
      if (stack.length) stack[stack.length - 1].children.push(el);
      else if (root) throw new XmlError("More than one root element");
      else root = el;
      if (!selfClosing) stack.push(el);
      i = j;
    }
  }

  if (stack.length) throw new XmlError(`Unclosed <${stack[stack.length - 1].name}>`);
  if (!root) throw new XmlError("No root element");
  return root;
}
