/**
 * The page's only way to the lobby: typed calls to `POST /api/<name>`. The
 * browser sends the session cookie same-origin; a 401 marks the page signed
 * out. `signIn` trades the link's `#token=…` for that cookie.
 */
import type { Api, ApiName, ApiReply, ErrorCode } from "@protocol"
import { lobbyStore } from "./store.ts"
import { projectUrl } from "./project.ts"

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly status: number

  constructor(message: string, code: ErrorCode, status: number) {
    super(message)
    this.name = "ApiError"
    this.code = code
    this.status = status
  }
}

const JSON_HEADERS = { "Content-Type": "application/json" }

/** `POST /api/<name>`; returns the result or throws the typed `ApiError`. */
export async function call<Name extends ApiName>(name: Name, body?: Api[Name]["request"]): Promise<Api[Name]["result"]>
export async function call<T = unknown>(name: string, body?: Record<string, unknown>): Promise<T>
export async function call(name: string, body: Record<string, unknown> = {}): Promise<unknown> {
  const response = await fetch(name === "auth.login" || name === "projects.list" ? `/api/${name}` : projectUrl(`/api/${name}`), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
    credentials: "same-origin",
  })
  const reply = (await response.json().catch(() => undefined)) as ApiReply<unknown> | undefined
  if (!reply) throw new ApiError(`the lobby answered ${response.status}`, "failed", response.status)
  if (!reply.ok) {
    if (reply.code === "unauthorized") lobbyStore.onStatus({ signedOut: true })
    throw new ApiError(reply.error, reply.code, response.status)
  }
  return reply.result
}

interface PageLocation {
  hash: string
  pathname: string
  search: string
}

interface PageHistory {
  replaceState(data: unknown, title: string, url: string): void
}

function pageLocation(): PageLocation | undefined {
  return (globalThis as { location?: PageLocation }).location
}

/** Trade the link's token for the cookie; true when a token was present. */
export async function signIn(): Promise<boolean> {
  const location = pageLocation()
  const token = location ? new URLSearchParams(location.hash.replace(/^#/, "")).get("token") : null
  if (!token) return false
  const response = await fetch("/api/auth.login", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ token }),
    credentials: "same-origin",
  }).catch(() => undefined)
  if (!response?.ok) return false
  const history = (globalThis as { history?: PageHistory }).history
  if (history) history.replaceState(null, "", location!.pathname + location!.search)
  lobbyStore.onStatus({ signedOut: false })
  return true
}
