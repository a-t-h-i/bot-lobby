/**
 * A session switch the lobby asked for and `/bot-lobby switch` has not run
 * yet. The lobby gets this window ready to leave (its owner clock held, a
 * hand-off to the background noted) before pi runs the command; when the
 * command does not switch after all, it undoes that here.
 */
let undo: (() => void) | undefined;

/** Note how to undo a switch the lobby got ready for. */
export function switchPending(fn: () => void): void {
  undo = fn;
}

/** The switch landed: nothing to undo. */
export function switchLanded(): void {
  undo = undefined;
}

/** The switch did not happen: undo what the lobby got ready. */
export function switchFailed(): void {
  const fn = undo;
  undo = undefined;
  fn?.();
}
