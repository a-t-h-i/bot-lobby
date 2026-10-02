/**
 * The slice of the lobby service (ARCHITECTURE §3) this starter needs, and a
 * fake that behaves like the oracle: it streams a Markdown reply word by word
 * and logs activity. In bot-lobby the real service wraps `lobbyFeed`, the task
 * store and the runtime's actions; the server never knows which it has.
 */
import type { ActivityEntry, ChatEntry, LobbySnapshot, Topic } from "./protocol.ts";

export interface LobbyService {
  snapshot(): LobbySnapshot;
  /** Text for the oracle; a notice for the user when it was not simply sent. */
  send(text: string): { notice?: string };
  abort(): void;
  /** Called with the topic that changed, and with every step of a streaming reply. */
  onChange(listener: (change: { topic: Topic } | { reply: string }) => void): () => void;
}

const REPLY = [
  "Here is the plan for **dark mode**:",
  "",
  "1. Add a `theme` setting with `light`, `dark` and `system`.",
  "2. Read `prefers-color-scheme` when it is `system`.",
  "3. Swap the colour tokens on `:root`.",
  "",
  "```css",
  ":root[data-theme=\"dark\"] { --bg: #111418; --fg: #e8eaed; }",
  "```",
  "",
  "| Step | Agent | Time |",
  "| --- | --- | --- |",
  "| Tokens | DESIGN | 4 min |",
  "| Setting | DEV | 6 min |",
  "",
  "<img src=x onerror=alert(1)> A link: [the spec](https://example.com/spec).",
].join("\n");

/** Earlier work, so the activity log shows each agent's colour and each kind of mark from the start. */
const HISTORY: Array<[source: string, text: string, kind: ActivityEntry["kind"]]> = [
  ["LOBBY", "track: full · small · DESIGN, DEV", "info"],
  ["MASTER", "scouting designer", "info"],
  ["DESIGN", "started as scout", "info"],
  ["DESIGN", "reading client/styles.css", "info"],
  ["DESIGN", "scout finished", "success"],
  ["DEV", "running npm test", "info"],
  ["QA", "one label is below 4.5:1 contrast", "warning"],
];

export class FakeService implements LobbyService {
  private readonly chat: ChatEntry[] = [];
  private readonly activity: ActivityEntry[] = [];
  private reply: string | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private nextId = 1;
  private readonly listeners = new Set<(change: { topic: Topic } | { reply: string }) => void>();
  private readonly options: { stepMs?: number };

  constructor(options: { stepMs?: number } = {}) {
    // A plain field, not a parameter property: Node runs this file by stripping types, which cannot rewrite those.
    this.options = options;
    const start = Date.now() - (HISTORY.length + 1) * 60_000;
    for (const [index, [source, text, kind]] of HISTORY.entries()) this.activity.push({ id: this.nextId++, at: start + index * 60_000, source, text, kind, pending: false });
    this.chat.push({ id: this.nextId++, at: Date.now(), role: "note", text: "Fake oracle: anything you send gets a streamed Markdown reply." });
  }

  snapshot(): LobbySnapshot {
    return {
      workspace: { name: "bot-lobby", branch: "main" },
      busy: this.timer !== undefined,
      chat: [...this.chat],
      ...(this.reply !== undefined ? { reply: this.reply } : {}),
      activity: [...this.activity],
    };
  }

  send(text: string): { notice?: string } {
    const trimmed = text.trim();
    if (!trimmed) return { notice: "type something first" };
    this.chat.push({ id: this.nextId++, at: Date.now(), role: "you", text: trimmed });
    if (this.timer) return { notice: "steering the running turn" };
    this.log("MASTER", "reading the request", "info", true);
    const words = REPLY.split(/(?<=\s)/);
    let shown = 0;
    this.reply = "";
    this.timer = setInterval(() => {
      shown += 1;
      this.reply = words.slice(0, shown).join("");
      this.emit({ reply: this.reply });
      if (shown >= words.length) this.finish();
    }, this.options.stepMs ?? 30);
    this.emit({ topic: "lobby" });
    return {};
  }

  abort(): void {
    if (!this.timer) return;
    this.finish("stopped");
  }

  onChange(listener: (change: { topic: Topic } | { reply: string }) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private finish(how: "done" | "stopped" = "done"): void {
    clearInterval(this.timer);
    this.timer = undefined;
    if (this.reply) this.chat.push({ id: this.nextId++, at: Date.now(), role: "oracle", text: this.reply });
    this.reply = undefined;
    for (const entry of this.activity) entry.pending = false;
    this.log("MASTER", how === "done" ? "replied" : "stopped by you", how === "done" ? "success" : "warning", false);
    this.emit({ topic: "lobby" });
  }

  private log(source: string, text: string, kind: ActivityEntry["kind"], pending: boolean): void {
    this.activity.push({ id: this.nextId++, at: Date.now(), source, text, kind, pending });
  }

  private emit(change: { topic: Topic } | { reply: string }): void {
    for (const listener of this.listeners) listener(change);
  }
}
