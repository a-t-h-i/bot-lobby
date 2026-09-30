/** The page's calls to the host half; DSH's login cookie goes with them. */
export async function api<T>(endpoint: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`/bot-lobby/api/${endpoint}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as { ok: boolean; result?: T; error?: string };
  if (!body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body.result as T;
}
