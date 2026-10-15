export interface HtmlPreview { html: string; css?: string }

/** Only the native DOM surface used by sanitization; root tests inject a structural fake. */
export interface PreviewElement {
  readonly localName: string
  readonly namespaceURI: string | null
  readonly attributes: Iterable<{ name: string; value: string }>
  readonly children: Iterable<PreviewElement>
  textContent: string | null
  readonly outerHTML: string
  remove(): void
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}
interface PreviewContainer {
  readonly children: Iterable<PreviewElement>
  readonly innerHTML: string
  querySelectorAll(selector: string): Iterable<PreviewElement>
}
export interface PreviewParser {
  parseFromString(source: string, type: "text/html"): { head: PreviewContainer; body: PreviewContainer }
}

function browserParser(): PreviewParser {
  const ctor = (globalThis as unknown as { DOMParser?: new () => PreviewParser }).DOMParser
  if (!ctor) throw new Error("DOMParser is unavailable")
  return new ctor()
}
export const PREVIEW_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"
// Controls are kept so a mockup can be tried, not just looked at: with no scripts (the sandbox and the CSP both
// forbid them) they still hover, focus, type, check, open (details) and animate through CSS alone. Forms, links
// and anything that loads a resource stay out; a submit could go nowhere anyway (no allow-forms, form-action 'none').
const ELEMENTS = new Set("div span p br hr h1 h2 h3 h4 h5 h6 section article header footer main aside nav ul ol li dl dt dd strong em b i u s small sub sup blockquote pre code table thead tbody tfoot tr th td caption colgroup col figure figcaption style button input label select option optgroup textarea details summary fieldset legend progress meter output kbd mark".split(" "))
const ATTRIBUTES = new Set("class id title role aria-label aria-hidden aria-expanded aria-selected aria-checked aria-pressed aria-current colspan rowspan scope type name value placeholder for checked selected disabled readonly open min max step rows cols tabindex".split(" "))
// Input types that only take what is typed or picked; the rest (file, image, …) fall back to text.
const INPUT_TYPES = new Set("text search email tel url number password checkbox radio range color date time month week button reset submit".split(" "))
// Every mockup's controls answer the pointer and keyboard with a short, quiet transition, unless motion is reduced.
const INTERACTION_CSS = "button,input,select,textarea,summary,label,[role=button],[role=tab]{transition:background-color .18s ease,color .18s ease,border-color .18s ease,box-shadow .18s ease,transform .18s ease,opacity .18s ease}button,summary,label,select,[role=button],[role=tab],input[type=checkbox],input[type=radio],input[type=range]{cursor:pointer}button:active,[role=button]:active{transform:scale(.97)}details[open]>:not(summary){animation:mockup-in .22s ease-out}@keyframes mockup-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}"

export function previewPayload(value: unknown): HtmlPreview | undefined {
  if (!value || typeof value !== "object") return undefined
  const p = value as Record<string, unknown>
  if (typeof p.html !== "string" || p.html.length > 100000) return undefined
  if (p.css !== undefined && (typeof p.css !== "string" || p.css.length > 120000)) return undefined
  return { html: p.html, ...(typeof p.css === "string" ? { css: p.css } : {}) }
}

/** Fail closed on CSS escape/comment tricks and resource-capable declarations. */
export function staticCss(css: string): string {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "")
  return /\\|@import|url\s*\(|image-set\s*\(|expression\s*\(|behavior\s*:|-moz-binding/i.test(plain) ? "" : plain.replace(/<\/?style/gi, "")
}

function cleanElement(element: PreviewElement): void {
  if (!ELEMENTS.has(element.localName) || element.namespaceURI !== "http://www.w3.org/1999/xhtml") { element.remove(); return }
  for (const attr of [...element.attributes]) {
    if (attr.name === "style") element.setAttribute("style", staticCss(attr.value))
    else if (!ATTRIBUTES.has(attr.name)) element.removeAttribute(attr.name)
  }
  if (element.localName === "input") {
    const type = [...element.attributes].find((attr) => attr.name === "type")?.value.toLowerCase()
    if (type !== undefined && !INPUT_TYPES.has(type)) element.setAttribute("type", "text")
  }
  if (element.localName === "style") element.textContent = staticCss(element.textContent ?? "")
  for (const child of [...element.children]) cleanElement(child)
}

/** Only allowlisted static DOM is serialized into the opaque sandbox. */
export function staticPreviewDocument(preview: HtmlPreview, parser?: PreviewParser): string {
  try {
    return sanitizedDocument(preview, parser ?? browserParser())
  } catch {
    return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><meta name="referrer" content="no-referrer"></head><body><p role="status">Static mockup unavailable. The preview could not be safely rendered.</p></body></html>`
  }
}

function sanitizedDocument(preview: HtmlPreview, parser: PreviewParser): string {
  const doc = parser.parseFromString(preview.html, "text/html")
  for (const child of [...doc.head.children, ...doc.body.children]) cleanElement(child)
  const styles = [...doc.head.querySelectorAll("style")].map((style) => style.outerHTML).join("")
  const css = staticCss(preview.css ?? "").replace(/</g, "\\3c ")
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><meta name="referrer" content="no-referrer"><style>body{margin:16px;overflow-wrap:anywhere}*{box-sizing:border-box}${INTERACTION_CSS}${css}</style>${styles}</head><body>${doc.body.innerHTML}</body></html>`
}
