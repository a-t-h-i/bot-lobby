/**
 * The page's non-content states: loading, error and reconnecting. Each
 * is a real state rather than a spinner over whatever was on screen before.
 */
import { RotateCw, TriangleAlert, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"

/** First paint, before the first answer lands. */
export function LoadingState({ label = "Connecting…" }: { label?: string }) {
  return (
    <div className="flex min-h-48 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Spinner />
      <span>{label}</span>
    </div>
  )
}

/** A topic that failed to load, with a retry that rereads it. */
export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <Empty className="m-4 flex-1">
      <EmptyHeader>
        <EmptyTitle className="flex items-center gap-2">
          <TriangleAlert className="size-4 text-destructive" aria-hidden="true" />
          Could not load this view
        </EmptyTitle>
        <EmptyDescription>{message ?? "The request failed. Try again."}</EmptyDescription>
      </EmptyHeader>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          <RotateCw aria-hidden="true" />
          Try again
        </Button>
      ) : null}
    </Empty>
  )
}

/** A dropped stream; data stays on screen, the banner offers a manual retry. */
export function ReconnectingState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div
      role="status"
      className="mx-3 mb-1 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive max-sm:mx-2"
    >
      <WifiOff className="size-4" aria-hidden="true" />
      <span>Connection lost — retrying every 2 s.</span>
      {onRetry ? (
        <Button variant="link" className="h-8 px-1 text-destructive" onClick={onRetry}>
          Retry now
        </Button>
      ) : null}
    </div>
  )
}
