/**
 * Pure metrics data helpers shared by the terminal tab and the web API.
 * This module touches neither the terminal nor pi-tui (unlike
 * `../tabs/metrics.ts`, which draws through `layout.ts`), so the loopback
 * server can import it freely.
 */
import type { MetricRecord } from "../../state/metrics.ts";

/** Runs whose agent, model, thinking level, kind, status or task mention `query`. */
export function filterRecords(records: readonly MetricRecord[], query: string | undefined): MetricRecord[] {
  const needle = query?.trim().toLowerCase();
  if (!needle) return [...records];
  return records.filter((record) => [record.agent, record.model ?? "", record.thinking ?? "", record.kind, record.status, record.taskId ?? ""].join(" ").toLowerCase().includes(needle));
}
