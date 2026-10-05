/**
 * Configured accelerators (the Alt and Ctrl chords) never act behind an open
 * dialog. They do work from a text field, the message box included: a chord
 * types nothing, and the keyboard-first page has to be drivable from where the
 * cursor sits. Saving the plan needs a plan to save.
 */
export function blocksConfiguredAction(action: string | undefined, state: { overlay: boolean; typing: boolean; saveAvailable: boolean }): boolean {
  if (state.overlay) return true
  return action === "savePlan" && !state.saveAvailable
}
