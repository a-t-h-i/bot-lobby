/**
 * Run a command in a new terminal of the page's own: the shell starts in the
 * project's folder, the command is typed into it, and the drawer opens on it,
 * so the user watches it and answers any question it asks. With no terminal
 * available the command is copied instead.
 */
import { call } from "@/lib/api"
import { toast } from "@/lib/toast"
import { showTerminal } from "./terminalStore"

export async function runInTerminal(command: string): Promise<void> {
  try {
    const list = await call("terminal.list", {})
    if (!list.available) {
      await copyCommand(command, list.reason ?? "No terminal is available here.")
      return
    }
    const info = await call("terminal.open", { cols: 100, rows: 24 })
    await call("terminal.input", { id: info.id, data: `${command}\r` })
    showTerminal(info.id)
  } catch (failure) {
    toast.error(failure instanceof Error ? failure.message : "The terminal did not start.")
  }
}

export async function copyCommand(command: string, why?: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(command)
    toast.success(why ? `${why} The command is copied.` : "Copied.")
  } catch {
    toast.error(why ?? "The command could not be copied.")
  }
}
