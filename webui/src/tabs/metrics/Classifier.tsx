/**
 * The classifier's box (batch-2 §j): `Classifier (Jev)`, its calls and speed,
 * then what its decisions spared — the terminal's `classifierLines` wording.
 */
import type { MetricsData } from "@protocol"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { millis, percent, tokens } from "./words"

type Summary = NonNullable<MetricsData["classifier"]>

function callsLine(summary: Summary): string {
  if (summary.calls === 0) return "no calls recorded"
  const purposes = Object.entries(summary.byPurpose)
    .sort((a, b) => b[1] - a[1])
    .map(([purpose, count]) => `${purpose} ${count}`)
    .join(" · ")
  return [
    `${summary.calls} call${summary.calls === 1 ? "" : "s"}`,
    `${percent(summary.ok, summary.calls)} ok`,
    `p50 ${millis(summary.p50Ms)}`,
    `p90 ${millis(summary.p90Ms)}`,
    summary.input > 0 ? `${tokens(summary.input)} tokens read` : "",
    purposes,
  ]
    .filter(Boolean)
    .join(" · ")
}

function sparedLine(summary: Summary): string {
  return [
    `${summary.seatRunsSkipped} seat run${summary.seatRunsSkipped === 1 ? "" : "s"} skipped`,
    `${summary.questionsAnswered} question${summary.questionsAnswered === 1 ? "" : "s"} answered`,
    `${summary.quickFixesHeld} quick fix${summary.quickFixesHeld === 1 ? "" : "es"} held`,
    summary.routed > 0 ? `${summary.routed} run${summary.routed === 1 ? "" : "s"} routed down, ${percent(summary.routedOk, summary.routed)} ok` : "no runs routed",
  ].join(" · ")
}

export function Classifier({ summary }: { summary: Summary }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Classifier (Jev)</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
        <p className="break-words">{callsLine(summary)}</p>
        <p className="break-words">
          <span className="text-primary">spared</span> {sparedLine(summary)}
        </p>
      </CardContent>
    </Card>
  )
}
