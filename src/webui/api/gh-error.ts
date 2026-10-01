/**
 * A failed `gh` read as an HTTP refusal. `gh` owns authentication and the
 * repository, and its failures arrive as one readable line (`ghError`): a
 * number it cannot find is 404, anything else (not installed, not signed in,
 * no GitHub remote, a timeout) is a 500 carrying that line. No token or
 * command line is ever in the message.
 */
import { fail } from "./index.ts";

const UNKNOWN_NUMBER = /could not resolve|no (pull request|issue)s? found|not found/i;

/** Refuse with `gh`'s own words (`what` names the read when it left none). */
export function ghRefusal(message: string | undefined, what: string): never {
  const text = message ?? `could not read ${what}`;
  if (UNKNOWN_NUMBER.test(text)) fail(404, "not_found", text);
  fail(500, "failed", text);
}
