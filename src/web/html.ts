/**
 * A forgiving HTML parser, just enough to read web pages: tags into a tree
 * (void elements, raw text in script/style, implied closes for p, li, td and
 * the like, stray end tags ignored), entities decoded. No dependency; not a
 * spec parser, and it does not need to be.
 */

export interface HtmlText {
  type: "text";
  text: string;
}

export interface HtmlElement {
  type: "element";
  name: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
}

export type HtmlNode = HtmlText | HtmlElement;

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
/** Elements whose content is text up to their end tag, never markup. */
const RAW = new Set(["script", "style", "textarea", "title", "xmp", "noscript", "template"]);
/** Opening one of these closes an open element of the listed names (up to the given boundaries). */
const IMPLIED: Record<string, { closes: string[]; within: string[] }> = {
  p: { closes: ["p"], within: ["div", "section", "article", "main", "body", "td", "th", "li", "blockquote"] },
  li: { closes: ["li"], within: ["ul", "ol", "menu"] },
  dt: { closes: ["dt", "dd"], within: ["dl"] },
  dd: { closes: ["dt", "dd"], within: ["dl"] },
  tr: { closes: ["tr", "td", "th"], within: ["table", "thead", "tbody", "tfoot"] },
  td: { closes: ["td", "th"], within: ["tr", "table"] },
  th: { closes: ["td", "th"], within: ["tr", "table"] },
  thead: { closes: ["thead", "tbody", "tr", "td", "th"], within: ["table"] },
  tbody: { closes: ["thead", "tbody", "tr", "td", "th"], within: ["table"] },
  tfoot: { closes: ["thead", "tbody", "tr", "td", "th"], within: ["table"] },
  option: { closes: ["option"], within: ["select", "datalist"] },
};
/** Block elements that end an open paragraph. */
const CLOSES_P = new Set(["address", "article", "aside", "blockquote", "details", "div", "dl", "fieldset", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "pre", "section", "table", "ul"]);

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", shy: "",
  copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–", minus: "−",
  lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„", laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›",
  bull: "•", middot: "·", times: "×", divide: "÷", deg: "°", plusmn: "±", para: "¶", sect: "§", dagger: "†", Dagger: "‡",
  euro: "€", pound: "£", yen: "¥", cent: "¢", larr: "←", rarr: "→", uarr: "↑", darr: "↓", harr: "↔", rArr: "⇒", lArr: "⇐",
  le: "≤", ge: "≥", ne: "≠", asymp: "≈", infin: "∞", micro: "µ", frac12: "½", frac14: "¼", frac34: "¾", sup2: "²", sup3: "³",
  zwj: "", zwnj: "", lrm: "", rlm: "", check: "✓", star: "☆", hearts: "♥",
};

/** Decode HTML character references (named ones pages commonly use, and every numeric one). */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);?/gi, (match, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
      return String.fromCodePoint(code);
    }
    const named = NAMED[ref] ?? NAMED[ref.toLowerCase()];
    return named ?? match;
  });
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[1]!.toLowerCase();
    if (name in attrs) continue;
    attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

/** Parse HTML into a tree under a synthetic root element named `#root`. */
export function parseHtml(html: string): HtmlElement {
  const root: HtmlElement = { type: "element", name: "#root", attrs: {}, children: [] };
  const stack: HtmlElement[] = [root];
  const current = () => stack[stack.length - 1]!;
  const openIndex = (names: string[], within: string[]): number => {
    for (let index = stack.length - 1; index > 0; index -= 1) {
      const name = stack[index]!.name;
      if (names.includes(name)) return index;
      if (within.includes(name)) return -1;
    }
    return -1;
  };
  const text = (value: string) => {
    if (!value) return;
    const parent = current();
    const last = parent.children[parent.children.length - 1];
    if (last?.type === "text") last.text += value;
    else parent.children.push({ type: "text", text: value });
  };

  let position = 0;
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\?[^>]*>/g;
  for (;;) {
    tag.lastIndex = position;
    const match = tag.exec(html);
    if (!match) {
      text(decodeEntities(html.slice(position)));
      break;
    }
    text(decodeEntities(html.slice(position, match.index)));
    position = match.index + match[0].length;
    if (!match[2]) continue; // comment, doctype, processing instruction
    const name = match[2].toLowerCase();
    if (match[1]) {
      // An end tag closes the nearest open element of that name; a stray one is ignored.
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index]!.name === name) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    const implied = IMPLIED[name];
    if (implied) {
      const index = openIndex(implied.closes, implied.within);
      if (index > 0) stack.length = index;
    }
    if (CLOSES_P.has(name)) {
      const index = openIndex(["p"], ["div", "section", "article", "main", "body", "td", "th", "li", "blockquote", "button"]);
      if (index > 0) stack.length = index;
    }
    const element: HtmlElement = { type: "element", name, attrs: parseAttrs(match[3] ?? ""), children: [] };
    current().children.push(element);
    if (RAW.has(name)) {
      const end = html.toLowerCase().indexOf(`</${name}`, position);
      const stop = end < 0 ? html.length : end;
      const raw = html.slice(position, stop);
      if (raw) element.children.push({ type: "text", text: name === "title" || name === "textarea" ? decodeEntities(raw) : raw });
      const close = end < 0 ? html.length : html.indexOf(">", end);
      position = close < 0 ? html.length : close + 1;
      continue;
    }
    if (!VOID.has(name) && !match[4]) stack.push(element);
  }
  return root;
}

/** Every element under `node` (depth first, document order) that passes `test`. */
export function findAll(node: HtmlElement, test: (element: HtmlElement) => boolean): HtmlElement[] {
  const found: HtmlElement[] = [];
  const walk = (element: HtmlElement) => {
    for (const child of element.children) {
      if (child.type !== "element") continue;
      if (test(child)) found.push(child);
      walk(child);
    }
  };
  walk(node);
  return found;
}

export function findFirst(node: HtmlElement, test: (element: HtmlElement) => boolean): HtmlElement | undefined {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (test(child)) return child;
    const found = findFirst(child, test);
    if (found) return found;
  }
  return undefined;
}

/** The text inside a node, whitespace collapsed. */
export function textOf(node: HtmlNode): string {
  const parts: string[] = [];
  const walk = (current: HtmlNode) => {
    if (current.type === "text") parts.push(current.text);
    else if (current.name !== "script" && current.name !== "style") for (const child of current.children) walk(child);
  };
  walk(node);
  return parts.join("").replace(/\s+/g, " ").trim();
}

export function hasClass(element: HtmlElement, name: string): boolean {
  return (element.attrs.class ?? "").split(/\s+/).includes(name);
}
