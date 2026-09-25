/**
 * Lenient markdown section parsing for agent output contracts. Agent prose is
 * untrusted input: headings vary in case, bullets vary in marker, and sections
 * may be missing entirely. Everything here degrades instead of throwing.
 */

import type { Pushback } from "../schemas/findings.ts";

/** Map lowercase heading text to its body for `##`/`###` sections. */
export function parseSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  let current: string | undefined;
  for (const line of markdown.split("\n")) {
    const heading = /^#{2,3}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = heading[1]!.toLowerCase();
      sections.set(current, "");
      continue;
    }
    if (current) sections.set(current, `${sections.get(current) ?? ""}${line}\n`);
  }
  return sections;
}

/** Read a `**Name:** value` field from a section body, trimmed. */
export function fieldValue(body: string, name: string): string | undefined {
  const match = new RegExp(`\\*\\*${name}:\\*\\*\\s*(.+)`, "i").exec(body);
  return match?.[1]?.trim();
}

/** Optional `## Pushback` block: request + reason (required) and an alternative. */
export function parsePushback(sections: Map<string, string>): Pushback | undefined {
  const body = findSection(sections, "pushback");
  if (!body) return undefined;
  const reason = fieldValue(body, "Reason");
  if (!reason) return undefined;
  const alternative = fieldValue(body, "Alternative");
  return { request: fieldValue(body, "Request") ?? "the assigned change", reason, alternative };
}
/** Find a section whose heading contains `name` (case-insensitive). */
export function findSection(sections: Map<string, string>, name: string): string | undefined {
  const needle = name.toLowerCase();
  for (const [heading, body] of sections) {
    if (heading.includes(needle)) return body.trim();
  }
  return undefined;
}

/** Extract bullet items from a section body, stripping list markers. */
export function bullets(text: string | undefined): string[] {
  return (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+\S/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) => line.length > 0);
}

/** Parse a `path — reason` bullet into its parts. */
export function parseFileBullet(text: string): { path: string; reason: string } {
  const match = /^`?([^`\s]+)`?\s*(?:[—–]|--|-)\s*(.*)$/.exec(text);
  if (match) return { path: match[1]!, reason: match[2]!.trim() };
  return { path: text.trim(), reason: "" };
}
