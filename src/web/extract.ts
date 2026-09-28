/**
 * A web page as a model reads it best: its title and dates, then the main
 * content as Markdown (headings, paragraphs, lists, tables, code, links made
 * absolute), with navigation, scripts, forms, cookie banners and the like
 * left out.
 */
import { findAll, findFirst, parseHtml, textOf, type HtmlElement, type HtmlNode } from "./html.ts";

export interface PageMeta {
  title?: string;
  description?: string;
  siteName?: string;
  published?: string;
  modified?: string;
  lang?: string;
}

export interface ReadablePage extends PageMeta {
  markdown: string;
}

/** Elements never worth reading. */
const DROP = new Set(["script", "style", "noscript", "template", "svg", "canvas", "iframe", "object", "embed", "video", "audio", "map", "head", "link", "meta", "button", "input", "select", "textarea", "form", "dialog", "nav"]);
/** Page chrome, dropped unless it is all there is. */
const CHROME = new Set(["aside", "footer"]);
/** Class or id words that mark page chrome rather than content. */
const CHROME_HINT = /(?:^|[\s_-])(cookie|consent|gdpr|banner|newsletter|subscribe|signup|sidebar|share|sharing|social|advert|ads?|promo|popup|modal|breadcrumbs?|related|comments?|skip-link|toc-mobile)(?:$|[\s_-])/i;
const BLOCK = new Set(["address", "article", "aside", "blockquote", "body", "center", "dd", "details", "dialog", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "html", "li", "main", "ol", "p", "pre", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul", "#root"]);

function isChrome(element: HtmlElement): boolean {
  if (element.attrs.hidden !== undefined || element.attrs["aria-hidden"] === "true") return true;
  if (element.attrs.role === "navigation" || element.attrs.role === "banner" || element.attrs.role === "contentinfo" || element.attrs.role === "dialog") return true;
  const style = element.attrs.style ?? "";
  if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) return true;
  if (!["div", "section", "aside", "ul", "span", "p", "header", "footer"].includes(element.name)) return false;
  return CHROME_HINT.test(`${element.attrs.class ?? ""} ${element.attrs.id ?? ""}`);
}

function metaContent(root: HtmlElement, ...keys: string[]): string | undefined {
  const metas = findAll(root, (element) => element.name === "meta");
  for (const key of keys) {
    const meta = metas.find((element) => (element.attrs.property ?? element.attrs.name ?? element.attrs.itemprop ?? "").toLowerCase() === key);
    const content = meta?.attrs.content?.trim();
    if (content) return content;
  }
  return undefined;
}

/** A date as it is written in structured data (JSON-LD), when the page has one. */
function jsonLdDate(root: HtmlElement, key: "datePublished" | "dateModified"): string | undefined {
  for (const script of findAll(root, (element) => element.name === "script" && (element.attrs.type ?? "").includes("ld+json"))) {
    const source = script.children.map((child) => (child.type === "text" ? child.text : "")).join("");
    const match = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`).exec(source);
    if (match) return match[1];
  }
  return undefined;
}

/** A date trimmed to what a citation needs: the day (ISO), or the text as the page gives it. */
function day(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (iso) return iso[1];
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value.trim().slice(0, 40) : new Date(parsed).toISOString().slice(0, 10);
}

export function pageMeta(root: HtmlElement): PageMeta {
  const titleElement = findFirst(root, (element) => element.name === "title");
  const title = metaContent(root, "og:title", "twitter:title") ?? (titleElement ? textOf(titleElement) : undefined);
  const time = findFirst(root, (element) => element.name === "time" && Boolean(element.attrs.datetime));
  const html = findFirst(root, (element) => element.name === "html");
  const meta: PageMeta = {
    title: title?.replace(/\s+/g, " ").trim() || undefined,
    description: metaContent(root, "description", "og:description", "twitter:description"),
    siteName: metaContent(root, "og:site_name", "application-name"),
    published: day(metaContent(root, "article:published_time", "datepublished", "date", "dc.date", "dc.date.issued", "dcterms.created", "pubdate", "citation_publication_date", "citation_date", "sailthru.date") ?? jsonLdDate(root, "datePublished") ?? time?.attrs.datetime),
    modified: day(metaContent(root, "article:modified_time", "og:updated_time", "datemodified", "last-modified", "dcterms.modified") ?? jsonLdDate(root, "dateModified")),
    lang: html?.attrs.lang,
  };
  return Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined)) as PageMeta;
}

/** The part of the page that is its content: main, the one article, role=main, or the body. */
function contentRoot(root: HtmlElement): HtmlElement {
  const main = findFirst(root, (element) => element.name === "main" || element.attrs.role === "main");
  if (main && textOf(main).length > 200) return main;
  const articles = findAll(root, (element) => element.name === "article");
  if (articles.length === 1 && textOf(articles[0]!).length > 200) return articles[0]!;
  const content = findFirst(root, (element) => ["content", "main-content", "maincontent"].includes((element.attrs.id ?? "").toLowerCase()));
  if (content && textOf(content).length > 200) return content;
  return findFirst(root, (element) => element.name === "body") ?? root;
}

/**
 * Drop what is never content; page chrome goes too unless nothing else is
 * left. Reading the whole body, its header (logo, site menu) is chrome as well.
 */
function prune(node: HtmlElement, keepChrome: boolean, dropHeader: boolean): HtmlElement {
  const children: HtmlNode[] = [];
  for (const child of node.children) {
    if (child.type === "text") children.push(child);
    else if (DROP.has(child.name)) continue;
    else if (!keepChrome && (CHROME.has(child.name) || isChrome(child) || (dropHeader && child.name === "header"))) continue;
    else children.push(prune(child, keepChrome, dropHeader));
  }
  return { ...node, children };
}

interface Context {
  /** Where relative links point from. */
  base: URL | undefined;
}

function absolute(href: string | undefined, base: URL | undefined): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || /^(javascript|mailto|tel|data):/i.test(trimmed)) return undefined;
  try {
    return new URL(trimmed, base).href;
  } catch {
    return undefined;
  }
}

function fence(code: string): string {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((run) => run[0].length));
  return "`".repeat(longest + 1);
}

function codeLanguage(element: HtmlElement): string {
  const code = findFirst(element, (child) => child.name === "code");
  const classes = `${element.attrs.class ?? ""} ${code?.attrs.class ?? ""} ${element.attrs["data-lang"] ?? ""}`;
  const match = /(?:language|lang|highlight-source)-([a-z0-9+#-]+)/i.exec(classes) ?? /^\s*([a-z0-9+#-]+)\s*$/i.exec(element.attrs["data-lang"] ?? "");
  return match?.[1]?.toLowerCase() ?? "";
}

function rawText(node: HtmlNode): string {
  if (node.type === "text") return node.text;
  if (node.name === "br") return "\n";
  return node.children.map(rawText).join("");
}

function wrapInline(text: string, mark: string): string {
  const trimmed = text.trim();
  if (!trimmed) return text;
  const lead = text.startsWith(" ") ? " " : "";
  const trail = text.endsWith(" ") ? " " : "";
  return `${lead}${mark}${trimmed}${mark}${trail}`;
}

/** A node's inline Markdown: text with emphasis, code, links and line breaks. */
function inline(node: HtmlNode, context: Context): string {
  if (node.type === "text") return node.text.replace(/\s+/g, " ");
  const inner = () => node.children.map((child) => inline(child, context)).join("");
  switch (node.name) {
    case "br":
      return "\n";
    case "img": {
      const alt = (node.attrs.alt ?? "").replace(/\s+/g, " ").trim();
      const src = absolute(node.attrs.src, context.base);
      return alt && src ? `![${alt}](${src})` : alt;
    }
    case "a": {
      const text = inner();
      const href = absolute(node.attrs.href, context.base);
      if (!text.trim()) return "";
      return href ? `${text.startsWith(" ") ? " " : ""}[${text.trim()}](${href})${text.endsWith(" ") ? " " : ""}` : text;
    }
    case "strong":
    case "b":
      return wrapInline(inner(), "**");
    case "em":
    case "i":
    case "cite":
      return wrapInline(inner(), "*");
    case "del":
    case "s":
    case "strike":
      return wrapInline(inner(), "~~");
    case "code":
    case "kbd":
    case "samp":
    case "tt": {
      const code = rawText(node).replace(/\s+/g, " ");
      if (!code.trim()) return code;
      const ticks = code.includes("`") ? "``" : "`";
      return `${ticks}${ticks.length > 1 ? " " : ""}${code.trim()}${ticks.length > 1 ? " " : ""}${ticks}`;
    }
    case "sup":
      return `^${inner().trim()}`;
    default:
      // A block inside inline content (a div in a link) reads as a spaced run.
      return BLOCK.has(node.name) ? ` ${inner()} ` : inner();
  }
}

function paragraph(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function indent(text: string, prefix: string, first = prefix): string {
  return text
    .split("\n")
    .map((line, index) => (index === 0 ? first : line ? prefix : "") + line)
    .join("\n");
}

function table(element: HtmlElement, context: Context): string {
  const rows = findAll(element, (child) => child.name === "tr").map((row) =>
    row.children
      .filter((cell): cell is HtmlElement => cell.type === "element" && (cell.name === "td" || cell.name === "th"))
      .map((cell) => paragraph(inline(cell, context)).replace(/\n+/g, " ").replace(/\|/g, "\\|")),
  );
  const filled = rows.filter((row) => row.some((cell) => cell));
  if (filled.length === 0) return "";
  const width = Math.max(...filled.map((row) => row.length));
  const line = (cells: string[]) => `| ${[...cells, ...Array(width - cells.length).fill("")].join(" | ")} |`;
  return [line(filled[0]!), `|${" --- |".repeat(width)}`, ...filled.slice(1).map(line)].join("\n");
}

function list(element: HtmlElement, context: Context): string {
  const ordered = element.name === "ol";
  let number = Number.parseInt(element.attrs.start ?? "1", 10) || 1;
  const items: string[] = [];
  for (const child of element.children) {
    if (child.type === "text") {
      if (child.text.trim()) items.push(`- ${child.text.trim()}`);
      continue;
    }
    const body = child.name === "li" ? blocks(child, context).join("\n") : blocks({ ...child, children: [child] }, context).join("\n");
    if (!body.trim()) continue;
    const marker = ordered ? `${number++}. ` : "- ";
    items.push(indent(body, " ".repeat(marker.length), marker));
  }
  return items.join("\n");
}

/** A block element as Markdown blocks. */
function block(element: HtmlElement, context: Context): string[] {
  switch (element.name) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const text = paragraph(inline(element, context)).replace(/\n+/g, " ");
      return text ? [`${"#".repeat(Number(element.name[1]))} ${text}`] : [];
    }
    case "p":
    case "summary":
    case "figcaption":
    case "dt": {
      const text = paragraph(element.children.map((child) => inline(child, context)).join(""));
      return text ? [element.name === "dt" ? `**${text}**` : text] : [];
    }
    case "pre": {
      const code = rawText(element).replace(/^\n/, "").replace(/\s+$/, "");
      if (!code.trim()) return [];
      const marks = fence(code);
      return [`${marks}${codeLanguage(element)}\n${code}\n${marks}`];
    }
    case "ul":
    case "ol":
    case "menu": {
      const text = list(element, context);
      return text ? [text] : [];
    }
    case "blockquote": {
      const inner = blocks(element, context).join("\n\n");
      return inner ? [indent(inner, "> ")] : [];
    }
    case "table": {
      const text = table(element, context);
      return text ? [text] : [];
    }
    case "hr":
      return ["---"];
    default:
      return blocks(element, context);
  }
}

/** The children of an element as Markdown blocks: inline runs become paragraphs. */
function blocks(element: HtmlElement, context: Context): string[] {
  const out: string[] = [];
  let run = "";
  const flush = () => {
    const text = paragraph(run);
    if (text) out.push(text);
    run = "";
  };
  for (const child of element.children) {
    if (child.type === "element" && BLOCK.has(child.name)) {
      flush();
      out.push(...block(child, context));
    } else {
      run += inline(child, context);
    }
  }
  flush();
  return out;
}

/** An HTML page as its metadata plus its main content in Markdown. */
export function htmlToMarkdown(html: string, url?: string): ReadablePage {
  const root = parseHtml(html);
  const meta = pageMeta(root);
  const baseHref = findFirst(root, (element) => element.name === "base")?.attrs.href;
  let base: URL | undefined;
  try {
    base = url ? new URL(baseHref ?? "", url) : undefined;
  } catch {
    base = undefined;
  }
  const content = contentRoot(root);
  const wholePage = content.name === "body" || content.name === "#root";
  let pruned = prune(content, false, wholePage);
  if (textOf(pruned).length < 80) pruned = prune(content, true, false);
  const markdown = blocks(pruned, { base })
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { ...meta, markdown };
}

