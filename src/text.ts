/** Truncate text to a character budget, marking how much was omitted. */
export function truncate(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[...${text.length - maxChars} characters omitted]`;
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
  const words = request.trim().split(/\s+/).filter(Boolean);
  const content = words.filter((word) => !FILLER_WORDS.has(fillerKey(word)));
  return (content.length > 0 ? content : words).slice(0, maxWords).join(" ");
}
