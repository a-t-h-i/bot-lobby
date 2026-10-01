/**
 * The placeholder body for the Settings route, which lands in Phase 5. It uses
 * the same empty-state card as the other tabs so the shell looks consistent.
 */
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"

function Placeholder({ label, detail }: { label: string; detail?: string }) {
  return (
    <Empty className="m-4 flex-1 border border-border bg-card">
      <EmptyHeader>
        <EmptyTitle>{label}</EmptyTitle>
        <EmptyDescription>
          {detail ? <span className="font-mono">{detail}</span> : `The ${label} tab arrives in a later step.`}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function SettingsTab({ detail }: { detail?: string }) {
  return <Placeholder label="Settings" detail={detail} />
}
