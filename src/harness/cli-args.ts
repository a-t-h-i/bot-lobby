/**
 * Splits a launch-arguments setting into argv the way a POSIX shell would
 * (quotes, backslash escapes), without running a shell.
 *
 * Adapted from T3 Code, `packages/shared/src/cliArgs.ts` (`tokenizeCliArgs`).
 */
export function tokenizeCliArgs(args?: string): ReadonlyArray<string> {
  const input = args?.trim();
  if (!input) return [];

  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let quoted = false;

  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === undefined) continue;

    if (quote) {
      if (char === quote) {
        quote = undefined;
        quoted = true;
      } else if (char === "\\" && quote === '"') {
        const next = input[index + 1];
        if (next !== undefined && ['"', "\\", "$", "`"].includes(next)) {
          current += next;
          index++;
        } else {
          current += char;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      quoted = true;
    } else if (/\s/.test(char)) {
      if (current || quoted) {
        tokens.push(current);
        current = "";
        quoted = false;
      }
    } else if (char === "\\") {
      const next = input[index + 1];
      if (next !== undefined && /[\s'"]/.test(next)) {
        current += next;
        index++;
      } else {
        current += char;
      }
    } else {
      current += char;
    }
  }

  if (current || quoted) tokens.push(current);
  return tokens;
}
