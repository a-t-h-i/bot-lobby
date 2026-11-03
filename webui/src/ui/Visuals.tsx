/**
 * Visuals any agent can put in a reply, as fenced blocks in its Markdown:
 * `mockup` (static HTML and CSS, drawn in the same sandbox as question
 * mockups) and `mermaid` (flowcharts, UML, ER, Gantt…, drawn as an SVG
 * picture). Both sit inline as thumbnails; the corner button (mockup) or a
 * click (diagram, into the lightbox) opens them large. Mermaid loads only
 * when a diagram first appears, and a diagram that will not parse (still
 * streaming, or wrong) shows its source as code instead.
 */
import { useEffect, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from "react"
import { Popup } from "@/components/ui/popup"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"
import { previewPayload } from "@/lib/staticPreview"
import { StaticPreview } from "@/prompts/StaticPreview"
import { lightboxClick } from "./Lightbox"

/** The page width a chat mockup is laid out at before it is scaled into its thumbnail. */
const MOCKUP_WIDTH = 1200
/** How long a diagram's source must hold still (while a reply streams) before it is drawn. */
const SETTLE_MS = 250

export function MockupBlock({ source, fallback }: { source: string; fallback: ReactNode }) {
  const preview = useMemo(() => previewPayload({ html: source }), [source])
  const [open, setOpen] = useState(false)
  const shown = useOverlaySlot(open, PRIORITY.sheet)
  if (!preview) return fallback
  return (
    <figure className="my-3 w-full max-w-[36rem]">
      <StaticPreview preview={preview} label="Mockup" frameWidth={MOCKUP_WIDTH} onOpen={() => setOpen(true)} className="aspect-[3/2] h-auto" />
      <Popup open={open && shown} onOpenChange={setOpen} label="Mockup" className="h-[min(92svh,60rem)] max-h-[min(92svh,60rem)] max-w-6xl">
        {open ? <StaticPreview preview={preview} label="Mockup" minWidth={1024} className="h-full min-h-[18rem]" /> : null}
      </Popup>
    </figure>
  )
}

function darkNow(): boolean { return document.documentElement.classList.contains("dark") }
function watchTheme(listener: () => void): () => void {
  const observer = new MutationObserver(listener)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] })
  return () => observer.disconnect()
}

/** A theme colour Mermaid can parse (hex or plain rgb), else `fallback`. */
function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return /^#[\da-f]{3,8}$|^rgba?\([\d\s.,]+\)$/i.test(value) ? value : fallback
}

function themeVariables(dark: boolean) {
  const text = token("--foreground", dark ? "#faf9f5" : "#141413")
  const line = token("--muted-foreground", dark ? "#a6a39a" : "#73726c")
  const node = token("--card", dark ? "#30302e" : "#ffffff")
  const edge = token("--border", dark ? "#3e3e38" : "#e3e0d7")
  return {
    darkMode: dark, background: "transparent", fontFamily: getComputedStyle(document.body).fontFamily, fontSize: "14px",
    primaryColor: node, primaryTextColor: text, primaryBorderColor: edge, secondaryColor: node, tertiaryColor: node,
    lineColor: line, textColor: text, mainBkg: node, nodeBorder: edge, clusterBkg: "transparent", clusterBorder: edge,
    noteBkgColor: node, noteTextColor: text, noteBorderColor: edge, actorBkg: node, actorBorder: edge, actorTextColor: text,
    signalColor: line, signalTextColor: text, labelBoxBkgColor: node, labelBoxBorderColor: edge, edgeLabelBackground: node,
  }
}

let queue = Promise.resolve()
/** Mermaid draws one diagram at a time (it shares state), so renders wait their turn. */
async function drawDiagram(id: string, source: string, dark: boolean): Promise<string> {
  const run = queue.then(async () => {
    const { default: mermaid } = await import("mermaid")
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: themeVariables(dark), htmlLabels: false, flowchart: { htmlLabels: false } })
    const { svg } = await mermaid.render(id, source)
    return sized(svg, token("--card", dark ? "#30302e" : "#ffffff"))
  })
  queue = run.then(() => undefined, () => undefined)
  return run
}

/** Mermaid sizes its SVG to 100% wide; as a picture it needs its own size, so the image is as big as the drawing. */
function sized(svg: string, paper: string): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml")
  const root = doc.documentElement
  const [, , width, height] = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number)
  if (width && height) { root.setAttribute("width", String(Math.ceil(width))); root.setAttribute("height", String(Math.ceil(height))) }
  root.setAttribute("style", `background-color:${paper}`)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`
}

export function DiagramBlock({ source, fallback }: { source: string; fallback: ReactNode }) {
  const id = `mmd-${useId().replace(/[^\w-]/g, "")}`
  const dark = useSyncExternalStore(watchTheme, darkNow, () => false)
  const [drawn, setDrawn] = useState<{ src?: string; failed?: boolean }>({})
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      drawDiagram(id, source, dark).then((src) => { if (live) setDrawn({ src }) }, () => { if (live) setDrawn((last) => ({ ...last, failed: true })) })
    }, SETTLE_MS)
    return () => { live = false; clearTimeout(timer) }
  }, [id, source, dark])
  if (!drawn.src) return drawn.failed ? fallback : <div role="status" aria-label="Drawing the diagram" className="my-3 h-24 w-full max-w-[36rem] animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
  return (
    <button type="button" className="md-image my-3 overflow-hidden rounded-lg border" aria-label="Diagram: open it larger" data-tip="Expand" onClick={lightboxClick({ src: drawn.src, alt: "Diagram" })}>
      <img src={drawn.src} alt="Diagram" className="h-auto" />
    </button>
  )
}
