/**
 * A tab that throws while drawing shows what went wrong, with Try again, instead of taking the whole page down
 * with it (React unmounts everything above an uncaught error, which left every tab blank and dead). Moving to
 * another tab clears it, since the boundary is keyed by the route.
 */
import { Component, type ErrorInfo, type ReactNode } from "react"

export class TabBoundary extends Component<{ children: ReactNode; fallback?: (error: Error, retry: () => void) => ReactNode }, { error?: Error }> {
  override state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("bot-lobby: a tab failed to draw", error, info.componentStack)
  }

  override render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, () => this.setState({ error: undefined }))
    return (
      <div role="alert" className="cs-pg cs-blank">
        <h2>This page hit a snag</h2>
        <p>{error.message || String(error)}</p>
        <p>
          <button type="button" className="cs-kc" onClick={() => this.setState({ error: undefined })}>Try again</button>
        </p>
      </div>
    )
  }
}
