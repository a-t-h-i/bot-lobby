import type { SessionProcess } from "../src/lobby/sessions.ts";

/** A headless pi as a background session sees it: JSON lines in, JSON lines out. */
export class FakeSessionProcess implements SessionProcess {
  readonly written: Array<Record<string, unknown>> = [];
  readonly signals: string[] = [];
  ended = false;
  private readonly listeners = new Map<string, Array<(value: never) => void>>();
  private readonly outListeners: Array<(chunk: string) => void> = [];
  private readonly errListeners: Array<(chunk: string) => void> = [];

  readonly stdin = {
    write: (text: string) => {
      for (const line of text.split("\n")) if (line.trim()) this.written.push(JSON.parse(line) as Record<string, unknown>);
      return true;
    },
    end: () => {
      this.ended = true;
    },
    on: () => undefined,
  };

  readonly stdout = { on: (_event: "data", listener: (chunk: string) => void) => void this.outListeners.push(listener) };
  readonly stderr = { on: (_event: "data", listener: (chunk: string) => void) => void this.errListeners.push(listener) };

  on(event: "exit", listener: (code: number | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: string, listener: (value: never) => void): unknown {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.signals.push(signal);
    this.exit(null);
    return true;
  }

  /** The session prints these events (split across chunks to exercise the framing). */
  emit(...events: Array<Record<string, unknown>>): void {
    const text = events.map((event) => `${JSON.stringify(event)}\n`).join("");
    const middle = Math.floor(text.length / 2);
    for (const chunk of [text.slice(0, middle), text.slice(middle)]) for (const listener of this.outListeners) listener(chunk);
  }

  stderrText(text: string): void {
    for (const listener of this.errListeners) listener(text);
  }

  exit(code: number | null): void {
    for (const listener of this.listeners.get("exit") ?? []) (listener as (code: number | null) => void)(code);
  }

  fail(error: Error): void {
    for (const listener of this.listeners.get("error") ?? []) (listener as (error: Error) => void)(error);
  }

  /** Commands of one type the session was sent. */
  commands(type: string): Array<Record<string, unknown>> {
    return this.written.filter((command) => command.type === type);
  }
}
