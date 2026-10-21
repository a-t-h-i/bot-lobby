/**
 * pi's conversation as one prompt for a harness. pi keeps the conversation
 * (its compaction, branches and resumes all still apply); each user turn
 * starts the harness afresh with the earlier messages written out above the
 * new request, and the turn's tool calls then go back and forth live.
 */
import { collapseSystemMessages, contentText, getCurrentSystemPrompt, getCurrentTools, type Message, type TranscriptContext } from "@earendil-works/pi-ai";
import type { BridgeResult, BridgeTool } from "./mcp-host.ts";

/** Longest tool result written into the replayed history; the model can run the tool again for the rest. */
const MAX_REPLAYED_RESULT = 4000;

export interface BridgeTurn {
  systemPrompt: string;
  tools: BridgeTool[];
  prompt: string;
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}\n[… ${text.length - limit} more characters]` : text;
}

function userText(message: Extract<Message, { role: "user" }>): string {
  if (typeof message.content === "string") return message.content;
  return message.content.map((block) => (block.type === "text" ? block.text : "[image]")).join("\n");
}

function render(message: Message): string {
  switch (message.role) {
    case "user":
      return `### User\n${userText(message)}`;
    case "assistant": {
      const parts = message.content.flatMap((block) => {
        if (block.type === "text" && block.text.trim()) return [block.text];
        if (block.type === "toolCall") return [`→ called \`${block.name}\` with ${JSON.stringify(block.arguments)}`];
        return [];
      });
      return parts.length > 0 ? `### You\n${parts.join("\n")}` : "";
    }
    case "toolResult": {
      const text = message.content.map((block) => (block.type === "text" ? block.text : "[image]")).join("\n");
      return `### \`${message.toolName}\` result${message.isError ? " (error)" : ""}\n${clip(text, MAX_REPLAYED_RESULT)}`;
    }
    default:
      return "";
  }
}

function toolsOf(messages: Message[]): BridgeTool[] {
  return getCurrentTools(messages).map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters as unknown as Record<string, unknown> }));
}

/** The tools of pi's current turn. */
export function bridgeTools(context: TranscriptContext): BridgeTool[] {
  return toolsOf(collapseSystemMessages(context).messages);
}

/** The system prompt, the tools and the prompt that start a harness on this conversation. */
export function bridgeTurn(context: TranscriptContext): BridgeTurn {
  const collapsed = collapseSystemMessages(context);
  const systemPrompt = getCurrentSystemPrompt(collapsed.messages);
  const tools = toolsOf(collapsed.messages);
  const turns = collapsed.messages.filter((message) => message.role !== "system");
  const last = turns.at(-1);
  const request = last?.role === "user" ? userText(last) : "Carry on from where the conversation above stops; the last tool results are the newest.";
  const history = (last?.role === "user" ? turns.slice(0, -1) : turns).map(render).filter(Boolean);
  const prompt = history.length > 0 ? `<conversation_so_far>\n${history.join("\n\n")}\n</conversation_so_far>\n\n${request}` : request;
  return { systemPrompt, tools, prompt };
}

/** A pi tool result as MCP content. */
export function bridgeResult(message: Extract<Message, { role: "toolResult" }>): BridgeResult {
  const content = message.content.map((block) => (block.type === "text" ? { type: "text" as const, text: block.text } : { type: "image" as const, data: block.data, mimeType: block.mimeType }));
  return { content: content.length > 0 ? content : [{ type: "text", text: contentText(message.content) || "(no output)" }], isError: message.isError };
}
