const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "when", "then",
  "than", "over", "under", "should", "must", "will", "not", "are", "was",
  "has", "have", "its", "a", "an", "of", "to", "in", "on", "or", "is", "be",
  "as", "by", "at", "it", "we", "you", "our", "use",
]);

export interface KnowledgeSelection {
  knowledge: string;
  standards: string;
  decisions: string;
}

export interface KnowledgeInput {
  knowledge?: string;
  standards?: string;
  decisions?: string;
}

export function tokenize(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9_.-]+/)
        .filter((token) => token.length >= 4 && !STOPWORDS.has(token)),
    ),
  ];
}

/** Split markdown into heading-anchored sections, keeping the preamble. */
export function splitSections(markdown: string): string[] {
  return markdown
    .split(/\n(?=#{1,3}\s)/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function score(sectionText: string, tokens: string[]): number {
  const lower = sectionText.toLowerCase();
  return tokens.reduce((total, token) => total + (lower.includes(token) ? 1 : 0), 0);
}

function takeWithin(parts: string[], budgetChars: number): string {
  const kept: string[] = [];
  let used = 0;
  for (const part of parts) {
    if (used + part.length > budgetChars) break;
    kept.push(part);
    used += part.length + 2;
  }
  return kept.join("\n\n").trim();
}

/**
 * Keep the whole file when it fits; otherwise return the sections most
 * relevant to the task, bounded by the budget.
 */
export function selectRelevant(query: string, content: string, budgetChars: number): string {
  const trimmed = content.trim();
  if (trimmed.length <= budgetChars) return trimmed;
  const tokens = tokenize(query);
  const ranked = splitSections(trimmed)
    .map((text) => ({ text, score: score(text, tokens) }))
    .sort((a, b) => b.score - a.score);
  const relevant = ranked.filter((entry) => entry.score > 0);
  const chosen = relevant.length > 0 ? relevant : ranked;
  return takeWithin(chosen.map((entry) => entry.text), budgetChars);
}

/** Select the relevant slice of each knowledge file for this task. */
export function selectKnowledge(
  task: string,
  files: KnowledgeInput,
  budgetChars = 4000,
): KnowledgeSelection {
  return {
    knowledge: selectRelevant(task, files.knowledge ?? "", budgetChars),
    standards: selectRelevant(task, files.standards ?? "", budgetChars),
    decisions: selectRelevant(task, files.decisions ?? "", budgetChars),
  };
}
