/**
 * Client half: runs in the DSH page. Adds the Bot Lobby page (the `main` slot,
 * keyed by the panel id) and its entry in the left sidebar (same id).
 */
import { useEffect, useState } from "react";
import { api } from "./api.ts";

export const PANEL_ID = "bot-lobby";

interface Route {
  route: { id: string; name: string };
  models: Array<{ id: string; name: string }>;
}

function LobbyPage() {
  const [routes, setRoutes] = useState<Route[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    api<Route[]>("models").then(setRoutes, (reason: unknown) => setError(String(reason)));
  }, []);
  return (
    <div data-testid="bot-lobby-page" style={{ padding: "var(--dsh-frame-top-clearance, 48px) 32px 32px" }}>
      <h1 style={{ fontSize: 20, margin: "0 0 12px" }}>Bot Lobby</h1>
      {error ? <p role="alert">{error}</p> : null}
      {routes === undefined && !error ? <p>Loading your models…</p> : null}
      <ul data-testid="bot-lobby-models">
        {routes?.flatMap((entry) => entry.models.map((model) => <li key={`${entry.route.id}/${model.id}`}>{entry.route.name} · {model.name}</li>))}
      </ul>
    </div>
  );
}

function LobbyIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden>
      <rect x={4} y={4} width={16} height={16} rx={4} fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}

/** The slice of the client Context this half uses. */
interface ClientContext {
  slots: {
    inject(slot: string, register: () => unknown): void;
    register(options: Record<string, unknown>, component: () => JSX.Element): unknown;
  };
}

export const inject = ["slots", "layout"];

export function apply(ctx: ClientContext): void {
  ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: PANEL_ID }, LobbyPage));
  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name: "sidebar.panellist", id: PANEL_ID, order: 90, label: () => "Bot Lobby" }, LobbyIcon));
}
