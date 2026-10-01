/**
 * The page's only way to the lobby: typed calls (`POST /api/<name>`) and the
 * event stream. Everything else in the page reads state from here, so the
 * transport can change in this one file (ARCHITECTURE §5).
 */
import type { Api, ApiName, ApiReply, StreamEvent } from "../server/protocol.ts";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function call<Name extends ApiName>(name: Name, request: Api[Name]["request"]): Promise<Api[Name]["result"]> {
  const response = await fetch(`/api/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    credentials: "same-origin",
  });
  const body = (await response.json().catch(() => undefined)) as ApiReply<Api[Name]["result"]> | undefined;
  if (!body) throw new ApiError(`the lobby answered ${response.status}`, "failed", response.status);
  if (!body.ok) throw new ApiError(body.error, body.code, response.status);
  return body.result;
}

/**
 * Trade the link's `#token=…` for the session cookie, and take the token out of
 * the address bar and history. True when signed in (or already was).
 */
export async function signIn(): Promise<boolean> {
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  if (token) {
    history.replaceState(null, "", location.pathname + location.search);
    try {
      await fetch("/api/auth.login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), credentials: "same-origin" }).then(async (response) => {
        if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error ?? "sign-in failed");
      });
    } catch {
      return false;
    }
  }
  try {
    await call("lobby.snapshot", {});
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return false;
    throw error;
  }
}

export type Connection = "connecting" | "live" | "lost";

/**
 * Follow the event stream. EventSource reconnects by itself (the server asks
 * for 2 s); a phone that slept or a Pi that restarted shows as `lost` until
 * then, and `hello` after a reconnect makes the page reread everything.
 */
export function follow(onEvent: (event: StreamEvent) => void, onConnection: (state: Connection) => void): () => void {
  const source = new EventSource("/api/events");
  onConnection("connecting");
  source.onopen = () => onConnection("live");
  source.onerror = () => onConnection(source.readyState === EventSource.CLOSED ? "lost" : "connecting");
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data as string) as StreamEvent);
    } catch {
      // A line the page cannot read is skipped; the next change rereads the topic anyway.
    }
  };
  return () => source.close();
}
