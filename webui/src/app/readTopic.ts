/**
 * Map a lobby topic to the one API call that reads it. Topics without an
 * endpoint yet (the placeholder tabs, notices) read `undefined` until a later
 * step gives them one; the store treats that as an empty answer.
 */
import { call } from "@/lib/api"
import type { LobbyTopic } from "@protocol"

export async function readTopic(topic: LobbyTopic): Promise<unknown> {
  switch (topic) {
    case "status":
      return call("status.get", {})
    case "lobby":
      return call("lobby.snapshot", {})
    case "prompts":
      return call("prompts.list", {})
    default:
      return undefined
  }
}
