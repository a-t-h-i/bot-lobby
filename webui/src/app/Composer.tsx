/**
 * The composer docked at the bottom of every route. Step 11 wires it to the
 * Lobby's composer: it sends to the oracle (`lobby.send`) and stops with
 * `lobby.abort` while the Master is busy, showing the returned notice as a
 * toast. The implementation lives with the Lobby tab.
 */
export { Composer } from "@/tabs/lobby/Composer"
