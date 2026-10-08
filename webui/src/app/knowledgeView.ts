import { tabHash } from "./router"

export function knowledgeView(rest: string[]) {
  const chat = rest[0] === "ask"
  const [agent, file] = chat ? rest.slice(1) : rest
  return { chat, agent, file }
}

export function knowledgeHash(rest: string[], chat: boolean): string {
  const { agent, file } = knowledgeView(rest)
  return tabHash("knowledge", ...(chat ? ["ask"] : []), agent ?? "", file ?? "")
}
