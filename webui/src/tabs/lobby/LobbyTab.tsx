/**
 * Placeholder Lobby body. Step 11 replaces this with the task header, runs
 * strip, conversation/activity/thinking panes and the composer wiring.
 */
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"

export function LobbyTab() {
  return (
    <Empty className="m-4 flex-1 border border-border bg-card">
      <EmptyHeader>
        <EmptyTitle>Lobby</EmptyTitle>
        <EmptyDescription>
          The conversation, activity log and thinking panes arrive in the next step.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
