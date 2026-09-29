/** Truncate text to a character budget, marking how much was omitted. */
export function truncate(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[...${text.length - maxChars} characters omitted]`;
}

/** The end of `text` within a character budget (the newest entries of a log), marking how much was left out before it. */
export function tail(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  return `[...${text.length - maxChars} earlier characters omitted]\n${text.slice(text.length - maxChars)}`;
}

/** Filler and imperative words that carry no topic signal in a request. */
const FILLER_WORDS = new Set([
  "let's",
  "lets",
  "please",
  "can",
  "you",
  "could",
  "i",
  "we",
  "want",
  "need",
  "would",
  "like",
  "to",
  "help",
  "me",
  "a",
  "an",
  "the",
  "for",
  "our",
  "my",
]);

/** Case- and punctuation-insensitive key used to match a word against the fillers. */
function fillerKey(word: string): string {
  return word
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[^a-z0-9']/g, "");
}

/**
 * The first `maxWords` content words of a request, used as the short task title.
 * Deterministic and total: whitespace-only input yields `""`, and a request
 * made entirely of filler words falls back to its raw first words.
 */
export function shortTitle(request: string, maxWords = 3): string {
  if (maxWords <= 0) return "";
  const words = titleText(request).split(/\s+/).filter(Boolean);
  const content = words.filter((word) => !FILLER_WORDS.has(fillerKey(word)));
  return (content.length > 0 ? content : words).slice(0, maxWords).join(" ").replace(/[:;,]+$/, "");
}

/** Words a task's name leaves out: they join the words that matter without being any of them. */
const NAME_CONNECTORS = new Set(["and", "or", "but", "with", "without", "on", "in", "at", "of", "by", "from", "into", "so", "as", "is", "are", "be", "it", "its", "that", "this", "then", "also", "just", "some"]);

/** `27-09-2026`: the local date as day-month-year, as task names carry it. */
export function dateStamp(now: Date): string {
  return `${String(now.getDate()).padStart(2, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()}`;
}

/**
 * The first content words of a request as one name part, each capitalised and
 * joined by dashes (`Change-Table-Font`): at most `maxWords` words and
 * `maxChars` characters, cut between words. Empty when the request has no
 * letters or digits.
 */
export function nameWords(request: string, maxWords = 5, maxChars = 36): string {
  // Connectors (`and`, `on`, `with`…) say little in a name and must not fill its few slots or end it.
  const words = shortTitle(request, maxWords * 3)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0 && !NAME_CONNECTORS.has(word.toLowerCase()))
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
    .slice(0, maxWords);
  const kept: string[] = [];
  for (const word of words) {
    if ([...kept, word].join("-").length > maxChars && kept.length > 0) break;
    kept.push(word);
  }
  return kept.join("-").slice(0, maxChars).replace(/-+$/, "");
}

/**
 * A task's friendly name: `Task-Change-Table-Font-27-09-2026`, from its
 * request (or title) and the day it started. It is the task's id, the name of
 * the git branch it works on and of the session that drives it.
 */
export function taskName(request: string, now = new Date()): string {
  return `Task-${nameWords(request) || "Untitled"}-${dateStamp(now)}`;
}

/** Headings that only label a section (`### Objective`), not name the work. */
const LABEL_HEADING = /^#{1,6}\s*(objective|goal|goals|summary|overview|task|request|context|background|description|plan)\s*:?\s*$/i;

/**
 * A request as words for a title: escaped line breaks (`\\n` written out by a
 * model) read as breaks, label headings are skipped, and Markdown marks
 * (`#`, `-`, `*`, `>`, backticks) are dropped.
 */
function titleText(request: string): string {
  return request
    .replace(/\\[nrt]/g, "\n")
    .split("\n")
    .filter((line) => !LABEL_HEADING.test(line.trim()))
    .join(" ")
    .replace(/[#*>`|]+/g, " ")
    .replace(/(^|\s)[-+](?=\s|$)/g, " ")
    .trim();
}

/** Compact duration such as "45s", "3m" or "2m 05s"; a non-finite input reads "0s". */
export function shortDuration(ms: number): string {
  const seconds = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0;
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return `${seconds}s`;
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${String(rest).padStart(2, "0")}s`;
}
