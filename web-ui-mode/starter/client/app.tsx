/**
 * The page: a header, the tabs and the Lobby tab (conversation, composer,
 * activity). Phone first: one pane at a time with the tabs at the bottom;
 * from 768 px the tabs move up, and from 1024 px the activity log sits beside
 * the conversation, as in the terminal lobby.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ActivityEntry, ChatEntry, LobbySnapshot } from "../server/protocol.ts";
import { call, follow, signIn, type Connection } from "./api.ts";
import { renderMarkdown } from "./markdown.ts";

type Tab = "lobby" | "tasks" | "plan" | "quickfix" | "more";
const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "lobby", label: "Lobby", icon: "M4 5h16v10H8l-4 4z" },
  { id: "tasks", label: "Tasks", icon: "M5 6h14M5 12h14M5 18h9" },
  { id: "plan", label: "Plan", icon: "M6 4h9l3 3v13H6zM9 10h6M9 14h6" },
  { id: "quickfix", label: "Quick fix", icon: "M13 3 5 14h6l-1 7 8-11h-6z" },
  { id: "more", label: "More", icon: "M5 12h.01M12 12h.01M19 12h.01" },
];

function Icon({ path }: { path: string }) {
  return (
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function Markdown({ text }: { text: string }) {
  // Sanitized in renderMarkdown; this is the one place the page sets HTML.
  return <div class="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}

function Message({ entry }: { entry: ChatEntry }) {
  return (
    <article class={`msg msg-${entry.role}`} data-testid="chat-message">
      <div class="msg-who">{entry.role === "you" ? "You" : entry.role === "oracle" ? "Oracle" : "Note"}</div>
      <Markdown text={entry.text} />
    </article>
  );
}

function Activity({ entries }: { entries: readonly ActivityEntry[] }) {
  if (entries.length === 0) return <p class="empty">No agent has done anything yet.</p>;
  return (
    <ol class="activity-list">
      {[...entries].reverse().map((entry) => (
        <li key={entry.id} class={`act act-${entry.kind}`} data-testid="activity-row">
          <span class="act-source">{entry.source}</span>
          <span class="act-text">
            {entry.text}
            {entry.pending ? "…" : ""}
          </span>
          <time class="act-time">{new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
        </li>
      ))}
    </ol>
  );
}

function Composer({ busy, onNotice }: { busy: boolean; onNotice: (text: string) => void }) {
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

  return (
    <form
      class="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <label class="sr-only" for="composer-text">
        Message the oracle
      </label>
      <textarea
        id="composer-text"
        ref={area}
        rows={1}
        value={text}
        placeholder={busy ? "Steer the running turn…" : "Ask for a change, or describe a task…"}
        data-testid="composer-input"
        onInput={(event) => setText((event.target as HTMLTextAreaElement).value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !touch && !event.isComposing) {
            event.preventDefault();
            void send();
          }
        }}
      />
      {busy ? (
        <button type="button" class="btn btn-quiet" data-testid="composer-stop" onClick={() => void call("lobby.abort", {}).catch((error: Error) => onNotice(error.message))}>
          Stop
        </button>
      ) : null}
      <button type="submit" class="btn btn-primary" data-testid="composer-send" disabled={!text.trim()}>
        Send
      </button>
    </form>
  );
}

function LobbyTab({ snapshot, reply, onNotice }: { snapshot: LobbySnapshot; reply: string | undefined; onNotice: (text: string) => void }) {
  const [pane, setPane] = useState<"chat" | "activity">("chat");
  const list = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const pending = snapshot.activity.filter((entry) => entry.pending).length;

  // Follow the conversation while the reader is at its end; leave them be when they scrolled up.
  useLayoutEffect(() => {
    const element = list.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [snapshot.chat.length, reply]);

  return (
    <div class="lobby" data-pane={pane}>
      <div class="segmented" role="tablist" aria-label="Lobby panes">
        <button role="tab" aria-selected={pane === "chat"} onClick={() => setPane("chat")}>
          Conversation
        </button>
        <button role="tab" aria-selected={pane === "activity"} onClick={() => setPane("activity")} data-testid="pane-activity">
          Activity{pending ? <span class="badge">{pending}</span> : null}
        </button>
      </div>
      <section class="pane chat" aria-label="Conversation">
        <div
          class="chat-list"
          ref={list}
          onScroll={(event) => {
            const element = event.currentTarget;
            pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
          }}
        >
          {snapshot.chat.map((entry) => (
            <Message key={entry.id} entry={entry} />
          ))}
          {reply !== undefined ? (
            <article class="msg msg-oracle msg-live" data-testid="chat-reply" aria-live="polite">
              <div class="msg-who">Oracle</div>
              <Markdown text={reply || "…"} />
            </article>
          ) : null}
        </div>
        <Composer busy={snapshot.busy} onNotice={onNotice} />
      </section>
      <aside class="pane activity" aria-label="Activity">
        <h2 class="pane-title">Activity</h2>
        <Activity entries={snapshot.activity} />
      </aside>
    </div>
  );
}

export function App() {
  const [state, setState] = useState<"signing-in" | "signed-out" | "ready">("signing-in");
  const [snapshot, setSnapshot] = useState<LobbySnapshot | undefined>(undefined);
  const [reply, setReply] = useState<string | undefined>(undefined);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [tab, setTab] = useState<Tab>("lobby");
  const [notice, setNotice] = useState<string | undefined>(undefined);

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

  if (state === "signed-out") {
    return (
      <main class="gate" data-testid="signed-out">
        <h1>bot-lobby</h1>
        <p>This page needs the link Pi printed. In Pi, run <code>/bot-lobby web</code> and open the link it shows.</p>
      </main>
    );
  }

  return (
    <div class="app" data-testid="app">
      <header class="top">
        <span class="brand" aria-hidden="true">
          ◆
        </span>
        <span class="where">
          {snapshot?.workspace.name ?? "bot-lobby"}
          {snapshot?.workspace.branch ? <span class="branch"> ⎇ {snapshot.workspace.branch}</span> : null}
        </span>
        <span class={`status status-${connection}`} data-testid="connection" role="status">
          {connection === "live" ? (snapshot?.busy ? "Working" : "Live") : connection === "connecting" ? "Connecting…" : "Pi is not reachable"}
        </span>
      </header>
      <nav class="tabs" aria-label="Lobby tabs">
        {TABS.map((entry) => (
          <button key={entry.id} class="tab" aria-current={tab === entry.id ? "page" : undefined} onClick={() => setTab(entry.id)}>
            <Icon path={entry.icon} />
            <span>{entry.label}</span>
          </button>
        ))}
      </nav>
      <main class="body">
        {tab !== "lobby" ? (
          <p class="empty">This tab is built in a later task (PLAN.md, Phase 4).</p>
        ) : snapshot ? (
          <LobbyTab snapshot={snapshot} reply={reply} onNotice={setNotice} />
        ) : (
          <p class="empty">Loading the lobby…</p>
        )}
      </main>
      {notice ? (
        <div class="toast" role="status" data-testid="notice">
          {notice}
        </div>
      ) : null}
    </div>
  );
}
