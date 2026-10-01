/**
 * The page's non-content states: loading, empty, error, reconnecting and the
 * below-768 px notice. Each is a real state rather than a spinner over
 * whatever was on screen before (D-14 "states").
 */
import { RotateCw, TriangleAlert, WifiOff } from "lucide-react"
import { NARROW_WINDOW } from "@shared"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"

/** First paint, before the first answer lands. */
export function LoadingState({ label = "Connecting…" }: { label?: string }) {
  return (
    <div className="flex min-h-svh items-center justify-center gap-2 text-sm text-muted-foreground">
      <Spinner />
      <span>{label}</span>
    </div>
  )
}

/** A screen with nothing to show yet. */
export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <Empty className="m-4 flex-1 border border-border bg-card">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  )
}

/** A topic that failed to load, with a retry that rereads it. */
export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <Empty className="m-4 flex-1 border border-destructive/40 bg-card">
      <EmptyHeader>
        <EmptyTitle className="flex items-center gap-2">
          <TriangleAlert className="size-4 text-destructive" aria-hidden="true" />
          Could not load this view
        </EmptyTitle>
        <EmptyDescription>{message ?? "The request failed. Try again."}</EmptyDescription>
      </EmptyHeader>
      {onRetry ? (
        <Button variant="outline" size="lg" className="h-10" onClick={onRetry}>
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
      className="flex items-center gap-2 border-b bg-muted px-4 py-2 text-sm text-muted-foreground"
    >
      <WifiOff className="size-4" aria-hidden="true" />
      <span>Connection lost — retrying every 2 s.</span>
      {onRetry ? (
        <Button variant="link" className="h-auto px-0" onClick={onRetry}>
          Retry now
        </Button>
      ) : null}
    </div>
  )
}

/** Capitalise the first letter of a shared lower-case string. */
export function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Below 768 px the whole app is replaced by this notice. */
export function NarrowWindow() {
  return (
    <div className="flex min-h-svh items-center justify-center p-8">
      <Empty className="max-w-md border border-border bg-card">
        <EmptyHeader>
          <EmptyTitle>{sentence(NARROW_WINDOW)}</EmptyTitle>
          <EmptyDescription>Open the lobby on a window at least 768 px wide.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
