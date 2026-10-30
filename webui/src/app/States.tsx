/**
 * The page's non-content states: loading, error and reconnecting. Each
 * is a real state rather than a spinner over whatever was on screen before.
 */
import { RotateCw, TriangleAlert, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"

/** The goo filter the loading blobs melt together through; drawn with them, so it works before the shell is up. */
function GooFilter() {
  return (
    <svg aria-hidden="true" width="0" height="0" className="absolute">
      <filter id="cs-loadgoo" x="-40%" y="-90%" width="180%" height="280%" colorInterpolationFilters="sRGB">
        <feGaussianBlur in="SourceGraphic" stdDeviation="3.2" result="b" />
        <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10" />
      </filter>
    </svg>
  )
}

/** First paint, before the first answer lands: three accent blobs that drift and merge. */
export function LoadingState({ label = "Connecting…" }: { label?: string }) {
  return (
    <div role="status" className="flex min-h-48 min-w-0 w-full max-w-full flex-1 items-center justify-center gap-5 overflow-y-auto px-4 py-8 text-sm text-muted-foreground">
      <GooFilter />
      <span aria-hidden="true" className="cs-gi cs-big"><span className="cs-gb cs-a" /><span className="cs-gb cs-b" /><span className="cs-gb cs-c" /></span>
      <span>{label}</span>
    </div>
  )
}

/** A topic that failed to load, with a retry that rereads it. */
export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="grid min-h-0 min-w-0 flex-1 place-items-center overflow-y-auto p-4">
      <div role="alert" className="cs-dlg cs-errc">
        <h2><TriangleAlert className="size-[18px] text-[var(--bad)]" aria-hidden="true" />Could not load this view</h2>
        <p>{message ?? "The request failed. Try again."}</p>
        {onRetry ? (
          <Button variant="outline" onClick={onRetry}>
            <RotateCw aria-hidden="true" />
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** A dropped stream (pi stopped or restarting); data stays on screen, the banner offers a manual retry. */
export function ReconnectingState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div role="status" className="cs-banner">
      <WifiOff className="cs-wi size-[18px]" aria-hidden="true" />
      <span className="min-w-0 flex-1">Lost pi — reconnecting every 2 s. Your planning session and tasks carry on when it is back.</span>
      {onRetry ? <Button onClick={onRetry}>Retry now</Button> : null}
    </div>
  )
}
