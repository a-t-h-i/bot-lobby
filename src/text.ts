/** Truncate text to a character budget, marking how much was omitted. */
export function truncate(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[...${text.length - maxChars} characters omitted]`;
}
