/** Configured accelerators never escape an active dialog or a text field. */
export function blocksConfiguredAction(action: string | undefined, state: { overlay: boolean; typing: boolean; saveAvailable: boolean }): boolean {
  if (state.overlay) return true
  if (state.typing && action !== "savePlan") return true
  return action === "savePlan" && !state.saveAvailable
}
