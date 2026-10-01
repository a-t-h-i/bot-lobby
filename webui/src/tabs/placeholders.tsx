/**
 * Placeholder bodies for every tab route. Step 10b proves routing and layout;
 * each tab's real content lands in a later step (the Lobby in Step 11). Every
 * body uses the same empty-state card so the shell looks consistent.
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

export function TasksTab({ detail }: { detail?: string }) {
  return <Placeholder label="Tasks" detail={detail} />
}

export function PlanTab({ detail }: { detail?: string }) {
  return <Placeholder label="Plan" detail={detail} />
}

export function QuickFixTab({ detail }: { detail?: string }) {
  return <Placeholder label="Quick fix" detail={detail} />
}

export function IssuesTab({ detail }: { detail?: string }) {
  return <Placeholder label="Issues" detail={detail} />
}

export function MetricsTab({ detail }: { detail?: string }) {
  return <Placeholder label="Metrics" detail={detail} />
}

export function GitTab({ detail }: { detail?: string }) {
  return <Placeholder label="Git" detail={detail} />
}

export function KnowledgeTab({ detail }: { detail?: string }) {
  return <Placeholder label="Knowledge" detail={detail} />
}

export function ExcalidrawTab({ detail }: { detail?: string }) {
  return <Placeholder label="Excalidraw" detail={detail} />
}

export function SessionsTab({ detail }: { detail?: string }) {
  return <Placeholder label="Sessions" detail={detail} />
}

export function SettingsTab({ detail }: { detail?: string }) {
  return <Placeholder label="Settings" detail={detail} />
}
