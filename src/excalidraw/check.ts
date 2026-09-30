/**
 * "Does this session work?": join the room for a moment, as a seat named
 * after the lobby, and say what is there — the server reached, who is in the
 * room, how much is on the board, whether the link's key fits. The seat leaves
 * again at once, so a check never leaves an extra collaborator in the room.
 */
import { ExcalidrawRoom, type RoomOptions } from "./client.ts";
import { parseRoomLink } from "./room.ts";

export interface CheckResult {
  ok: boolean;
  text: string;
}

export async function checkSession(link: string, name: string, options: Pick<RoomOptions, "server" | "sceneWaitMs" | "connectTimeoutMs" | "connect"> = {}): Promise<CheckResult> {
  const parsed = parseRoomLink(link);
  if (!parsed) return { ok: false, text: "not a valid room link" };
  const room = new ExcalidrawRoom({ link: parsed, username: "bot-lobby · check", name, ...options });
  try {
    const status = await room.ready();
    // Give an answer to the newcomer's arrival a moment more when someone is there but the board has not come yet.
    if (status.undecryptable > 0 && status.elements === 0) return { ok: false, text: "reached the room, but its messages would not open: the link's key does not match, so it may have been copied incompletely" };
    if (status.peers === 0) return { ok: true, text: "reached the server; nobody has this session open yet — open the link in Excalidraw, and agents can read and draw" };
    const who = status.people.length > 0 ? status.people.join(", ") : `${status.peers} other${status.peers === 1 ? "" : "s"}`;
    return { ok: true, text: `reached the room with ${who}; ${status.synced ? `${status.elements} element${status.elements === 1 ? "" : "s"} on the board` : "the board has not been sent yet (it comes when someone in the room answers)"}` };
  } catch (error) {
    return { ok: false, text: (error as Error).message };
  } finally {
    room.close();
  }
}
