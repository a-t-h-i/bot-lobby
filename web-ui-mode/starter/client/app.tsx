/**
 * The page, drawn like the terminal lobby: the title line (workspace, the
 * tabs as cells, the status), panes framed with their titles in the border,
 * the composer between two rules and the key line under it. Phone first: the
 * tabs take a line of their own and one pane shows at a time, switched from
 * its frame; from 1024 px the tabs join the title line and the activity log
 * sits beside the conversation, as in the terminal.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ActivityEntry, ChatEntry, LobbySnapshot } from "../server/protocol.ts";
import { call, follow, signIn, type Connection } from "./api.ts";
import { renderMarkdown } from "./markdown.ts";

/** The terminal lobby's tabs, in its order (`TAB_IDS` in src/lobby/view.ts; Issues is off by default). */
const TABS = [
  { id: "lobby", label: "Lobby" },
  { id: "tasks", label: "Tasks" },
  { id: "plan", label: "Plan" },
  { id: "quickfix", label: "Quick fix" },
  { id: "metrics", label: "Metrics" },
  { id: "git", label: "Git" },
  { id: "knowledge", label: "Knowledge" },
  { id: "excalidraw", label: "Excalidraw" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** The terminal's spinner (`SPINNER` in src/lobby/layout.ts). */
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Each agent's colour, as the terminal paints it (`SOURCE_COLORS` in src/lobby/tabs/home.ts); the stylesheet maps each to a token. */
const SOURCE_COLORS: Record<string, string> = {
  MASTER: "accent",
  DEV: "success",
  DESIGN: "heading",
  QA: "warning",
  RESEARCH: "text",
  "QUICK FIX": "code",
  ORACLE: "accent",
  LOBBY: "muted",
};

const MARKS: Record<ActivityEntry["kind"], string> = { info: "·", success: "✓", warning: "!", error: "✗" };

/** Messages from one speaker this close together share a header, as in the terminal (`GROUP_MS`). */
const GROUP_MS = 5 * 60_000;

function clock(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function Spinner() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setTick((value) => value + 1), 80);
    return () => clearInterval(timer);
  }, []);
  return (
    <span class="spin" aria-hidden="true">
      {SPINNER[tick % SPINNER.length]}
    </span>
  );
}

function Markdown({ text }: { text: string }) {
  // Sanitized in renderMarkdown; this is the one place the page sets HTML.
  return <div class="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}

/** A pane: a rounded frame with its title set into the top border, as the terminal draws it. */
function Frame({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <div class="panes">
      <section class="pane" aria-label={title}>
        <h2 class="pane-title">{title}</h2>
        <div class="scroll">{children}</div>
      </section>
    </div>
  );
}

/** Who speaks and when: `◆ Oracle ···· 12:04` on the left, `12:04  You ●` on the right. */
function Speaker({ who, note }: { who: "you" | "oracle"; note: ComponentChildren }) {
  if (who === "you") {
    return (
      <div class="who who-you">
        <span class="who-note">{note}</span>
        <b>You</b>
        <span aria-hidden="true">●</span>
      </div>
    );
  }
  return (
    <div class="who who-oracle">
      <span aria-hidden="true">◆</span>
      <b>Oracle</b>
      <span class="who-note">{note}</span>
    </div>
  );
}

function Message({ entry, head }: { entry: ChatEntry; head: boolean }) {
  if (entry.role === "note") {
    // An event in the conversation: a centred rule, or a failure that stands out (`eventLines`).
    const failed = entry.text.startsWith("✗");
    return (
      <div class={`event${failed ? " event-error" : ""}`} data-testid="chat-message">
        <span class="event-text">
          {entry.text}
          {failed ? "" : ` · ${clock(entry.at)}`}
        </span>
      </div>
    );
  }
  const name = entry.role === "you" ? "You" : "Oracle";
  return (
    <article class={`msg msg-${entry.role}`} data-testid="chat-message" aria-label={`${name}, ${clock(entry.at)}`}>
      {head ? <Speaker who={entry.role} note={<time>{clock(entry.at)}</time>} /> : null}
      <div class="msg-body">
        <Markdown text={entry.text} />
      </div>
    </article>
  );
}

function Activity({ entries }: { entries: readonly ActivityEntry[] }) {
  if (entries.length === 0) return <p class="empty">No activity yet.</p>;
  return (
    <ol class="activity-list">
      {entries.map((entry) => (
        <li key={entry.id} class={`act act-${entry.kind}${entry.pending ? " act-pending" : ""}`} data-testid="activity-row">
          <time class="act-time">{clock(entry.at)}</time>
          <span class="act-who" data-color={SOURCE_COLORS[entry.source] ?? "muted"}>
            {entry.source}
          </span>
          <span class="act-mark" aria-hidden="true">
            {entry.pending ? <Spinner /> : MARKS[entry.kind]}
          </span>
          <span class="act-text">
            {entry.text}
            {entry.pending ? "…" : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Keeps a list at its end while the reader is there, and leaves them be once they scroll up. */
function useFollow(deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, deps);
  const onScroll = (event: Event) => {
    const element = event.currentTarget as HTMLDivElement;
    pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
  };
  return { ref, onScroll };
}

function Composer({ busy, onNotice, onTyping }: { busy: boolean; onNotice: (text: string) => void; onTyping: (typing: boolean) => void }) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  // Touch keyboards have no Shift+Enter, so there Enter is a new line and the button sends.
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }, [text]);

  const send = async () => {
    if (!text.trim()) return;
    const sent = text;
    setText("");
    try {
      const result = await call("lobby.send", { text: sent });
      if (result.notice) onNotice(result.notice);
    } catch (error) {
      setText(sent);
      onNotice((error as Error).message);
    }
  };
  const stop = () => void call("lobby.abort", {}).catch((error: Error) => onNotice(error.message));

  // The terminal's prompt label: what Enter does, and that it steers a running turn.
  const how = busy ? `${touch ? "send" : "enter"} steers the running turn` : touch ? "" : "enter sends";

  return (
    <form
      class="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <label class="composer-label" for="composer-text">
        <span>{how ? `message the oracle · ${how}` : "message the oracle"}</span>
      </label>
      <div class="composer-row">
        <textarea
          id="composer-text"
          ref={area}
          rows={1}
          value={text}
          data-testid="composer-input"
          onFocus={() => onTyping(true)}
          onBlur={() => onTyping(false)}
          onInput={(event) => setText((event.target as HTMLTextAreaElement).value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !touch && !event.isComposing) {
              event.preventDefault();
              void send();
            } else if (event.key === "Escape" && busy) {
              event.preventDefault();
              stop();
            }
          }}
        />
        {busy ? (
          <button type="button" class="key key-stop" data-testid="composer-stop" onClick={stop}>
            stop
          </button>
        ) : null}
        <button type="submit" class="key" data-testid="composer-send" disabled={!text.trim()}>
          send
        </button>
      </div>
    </form>
  );
}

function LobbyTab({ snapshot, reply, onNotice, onTyping }: { snapshot: LobbySnapshot; reply: string | undefined; onNotice: (text: string) => void; onTyping: (typing: boolean) => void }) {
  const [pane, setPane] = useState<"chat" | "activity">("chat");
  const pending = snapshot.activity.filter((entry) => entry.pending).length;
  const chat = useFollow([snapshot.chat.length, reply, pane]);
  const activity = useFollow([snapshot.activity.length, pane]);

  return (
    <div class="lobby" data-pane={pane}>
      <div class="panes">
        {/* Phones show one pane at a time; its frame carries both titles, and the one shown is lit. */}
        <div class="pane-switch" role="tablist" aria-label="Lobby panes">
          <button role="tab" aria-selected={pane === "chat"} onClick={() => setPane("chat")}>
            Conversation
          </button>
          <button role="tab" aria-selected={pane === "activity"} onClick={() => setPane("activity")} data-testid="pane-activity">
            Activity
            {pending ? <span class="count"> {pending}</span> : null}
          </button>
        </div>
        <section class="pane chat" aria-label="Conversation">
          <h2 class="pane-title">Conversation</h2>
          <div class="scroll" tabIndex={0} ref={chat.ref} onScroll={chat.onScroll}>
            {snapshot.chat.map((entry, index) => {
              const previous = snapshot.chat[index - 1];
              const head = !previous || previous.role !== entry.role || entry.at - previous.at > GROUP_MS;
              return <Message key={entry.id} entry={entry} head={head} />;
            })}
            {reply !== undefined ? (
              <article class="msg msg-oracle msg-live" data-testid="chat-reply" aria-live="polite">
                <Speaker
                  who="oracle"
                  note={
                    <>
                      <Spinner /> working…
                    </>
                  }
                />
                <div class="msg-body">
                  <Markdown text={reply} />
                </div>
              </article>
            ) : null}
          </div>
        </section>
        <section class="pane activity" aria-label="Activity">
          <h2 class="pane-title">Activity</h2>
          {pending ? (
            <span class="pane-note">
              <Spinner /> {pending} running
            </span>
          ) : null}
          <div class="scroll" tabIndex={0} ref={activity.ref} onScroll={activity.onScroll}>
            <Activity entries={snapshot.activity} />
          </div>
        </section>
      </div>
      <Composer busy={snapshot.busy} onNotice={onNotice} onTyping={onTyping} />
    </div>
  );
}

function Status({ connection, busy }: { connection: Connection; busy: boolean }) {
  return (
    <span class={`status status-${connection}`} data-testid="connection" role="status">
      {connection === "live" ? (
        busy ? (
          <>
            <Spinner /> working
          </>
        ) : (
          <>
            <span class="dot" aria-hidden="true">●</span> live
          </>
        )
      ) : connection === "connecting" ? (
        "connecting…"
      ) : (
        "✗ Pi is not reachable"
      )}
    </span>
  );
}

/** The terminal's key line: the mode, then each key in the accent colour and what it does dimmed. */
function KeyHints({ typing, busy }: { typing: boolean; busy: boolean }) {
  const keys: Array<[string, string]> = typing
    ? [["enter", busy ? "steer" : "send"], ["shift+enter", "new line"], ...(busy ? ([["esc", "stop the oracle"]] as Array<[string, string]>) : [])]
    : [
        [`alt+1…${TABS.length}`, "tabs"],
        ["↑↓ pgup pgdn", "scroll the pane you clicked"],
      ];
  return (
    <>
      <span class={`mode${typing ? "" : " mode-browse"}`}>{typing ? "TYPE" : "BROWSE"}</span>
      {keys.map(([key, what]) => (
        <span key={key} class="hint">
          <b>{key}</b> {what}
        </span>
      ))}
    </>
  );
}

export function App() {
  const [state, setState] = useState<"signing-in" | "signed-out" | "ready">("signing-in");
  const [snapshot, setSnapshot] = useState<LobbySnapshot | undefined>(undefined);
  const [reply, setReply] = useState<string | undefined>(undefined);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [tab, setTab] = useState<Tab>("lobby");
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [typing, setTyping] = useState(false);
  const tabs = useRef<HTMLElement>(null);

  useEffect(() => {
    let stop = () => {};
    const reload = () =>
      call("lobby.snapshot", {})
        .then((next) => {
          setSnapshot(next);
          setReply(next.reply);
        })
        .catch((error: Error) => setNotice(error.message));
    signIn()
      .then((ok) => {
        if (!ok) return setState("signed-out");
        setState("ready");
        stop = follow((event) => {
          if (event.type === "reply") setReply(event.text);
          else void reload();
        }, setConnection);
      })
      .catch(() => setState("signed-out"));
    return () => stop();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Alt+1…8 switches tabs, as in the terminal, where the browser leaves those keys to the page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const entry = TABS[Number(/^Digit([1-9])$/.exec(event.code)?.[1] ?? 0) - 1];
      if (!entry) return;
      event.preventDefault();
      setTab(entry.id);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  // On a phone the tabs scroll sideways; keep the chosen one in view.
  useEffect(() => {
    tabs.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab, state]);

  if (state === "signed-out") {
    return (
      <main class="gate" data-testid="signed-out">
        <section class="pane" aria-label="bot-lobby">
          <h1 class="pane-title">◆ bot-lobby</h1>
          <div class="scroll">
            <p>
              This page needs the link Pi printed. In Pi, run <code>/bot-lobby web</code> and open the link it shows.
            </p>
          </div>
        </section>
      </main>
    );
  }

  const label = TABS.find((entry) => entry.id === tab)!.label;
  return (
    <div class="app" data-testid="app">
      <header class="top">
        <span class="title">
          <span class="glyph" aria-hidden="true">
            ◆
          </span>{" "}
          <b class="name">{snapshot?.workspace.name ?? "bot-lobby"}</b>
          {snapshot?.workspace.branch ? <span class="branch"> (⎇ {snapshot.workspace.branch})</span> : null}
        </span>
        <span class="sep" aria-hidden="true">
          │
        </span>
        <nav class="tabs" aria-label="Lobby tabs" ref={tabs}>
          {TABS.map((entry, index) => (
            <button key={entry.id} class="tab" aria-current={tab === entry.id ? "page" : undefined} aria-keyshortcuts={`Alt+${index + 1}`} onClick={() => setTab(entry.id)}>
              <span class="tab-n">{index + 1}</span> {entry.label}
            </button>
          ))}
        </nav>
        <Status connection={connection} busy={snapshot?.busy ?? false} />
      </header>
      <main class="body">
        {snapshot ? (
          // Kept while another tab shows, so a draft in the composer survives a tab switch, as in the terminal.
          <div class="view" hidden={tab !== "lobby"}>
            <LobbyTab snapshot={snapshot} reply={reply} onNotice={setNotice} onTyping={setTyping} />
          </div>
        ) : tab === "lobby" ? (
          <Frame title="Lobby">
            <p class="empty">Loading the lobby…</p>
          </Frame>
        ) : null}
        {tab !== "lobby" ? (
          <Frame title={label}>
            <p class="empty">The {label} tab is built in a later task (PLAN.md, Phase 4).</p>
          </Frame>
        ) : null}
      </main>
      <footer class={`keys${notice ? " keys-notice" : ""}`}>
        <span class="notice" role="status" data-testid={notice ? "notice" : undefined}>
          {notice ?? ""}
        </span>
        {notice ? null : <KeyHints typing={typing} busy={snapshot?.busy ?? false} />}
      </footer>
    </div>
  );
}
