/**
 * A static HTML/CSS mockup in its sandbox. Given `frameWidth`, it is laid out
 * at that width (a desktop page) and scaled down to fit its box, so a small
 * preview reads as a thumbnail of the real thing instead of reflowing into a
 * narrow column; `onOpen` then makes the thumbnail open it larger. Given
 * `minWidth`, it fills its box and is scaled only where the box is narrower
 * than that (the expanded viewer on a phone).
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react"
import { Maximize2 } from "lucide-react"
import { staticPreviewDocument, type HtmlPreview } from "@/lib/staticPreview"
import { cn } from "@/lib/utils"

interface StaticPreviewProps {
  preview: HtmlPreview
  label: string
  className?: string
  /** Lay it out this wide and scale it to fit (a thumbnail). */
  frameWidth?: number
  /** Lay it out at least this wide, scaling it down in a narrower box. */
  minWidth?: number
  /** Opens it larger: the thumbnail becomes a button. */
  onOpen?: () => void
}

export function StaticPreview({ preview, label, className, frameWidth, minWidth, onOpen }: StaticPreviewProps) {
  const source = useMemo(() => staticPreviewDocument(preview), [preview])
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number }>()
  useLayoutEffect(() => {
    const element = box.current
    if ((!frameWidth && !minWidth) || !element) return
    const read = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    read()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(read)
    observer.observe(element)
    return () => observer.disconnect()
  }, [frameWidth, minWidth])
  if (!frameWidth && !minWidth) return <iframe title={`Static mockup: ${label}`} sandbox="" referrerPolicy="no-referrer" srcDoc={source} className={cn("h-80 w-full rounded-lg border bg-background", className)} />
  const width = frameWidth ?? Math.max(size?.width ?? 0, minWidth ?? 0)
  const scale = size && size.width > 0 && width > 0 ? Math.min(1, size.width / width) : 1
  return (
    <div ref={box} className={cn("group/mock relative h-80 w-full overflow-hidden rounded-lg border bg-background", className)}>
      <iframe
        title={`Static mockup: ${label}`}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={source}
        tabIndex={onOpen ? -1 : undefined}
        className={cn("absolute top-0 left-0 origin-top-left border-0", onOpen && "pointer-events-none")}
        style={{ width: width || "100%", height: size ? size.height / scale : "100%", transform: `scale(${scale})` }}
      />
      {onOpen ? (
        <button
          type="button"
          data-compact=""
          onClick={onOpen}
          aria-label={`Expand the mockup: ${label}`}
          className="absolute inset-0 flex items-end justify-end p-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-inset"
        >
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card/90 px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground opacity-0 shadow-sm backdrop-blur transition-opacity group-hover/mock:opacity-100 group-focus-within/mock:opacity-100">
            <Maximize2 aria-hidden="true" className="size-3" />
            Expand
          </span>
        </button>
      ) : null}
    </div>
  )
}
