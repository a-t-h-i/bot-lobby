/**
 * Web search through whichever provider is set up: Brave (`BRAVE_API_KEY`),
 * Tavily (`TAVILY_API_KEY`), Exa (`EXA_API_KEY`) or a SearXNG instance
 * (`SEARXNG_URL`), in that order, or DuckDuckGo's HTML page, which needs no
 * key but throttles automated searches. `BOT_LOBBY_SEARCH` picks one by name.
 * When a keyed provider fails, DuckDuckGo is tried before giving up.
 */
import { fetchPage, type FetchOptions } from "./fetch.ts";
import { findAll, hasClass, parseHtml, textOf } from "./html.ts";

export const PROVIDERS = ["brave", "tavily", "exa", "searxng", "duckduckgo"] as const;
export type ProviderName = (typeof PROVIDERS)[number];
export const RECENCY = ["day", "week", "month", "year"] as const;
export type Recency = (typeof RECENCY)[number];

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  /** When the result says it was published, as the provider gives it. */
  date?: string;
}

export interface SearchRequest {
  query: string;
  limit: number;
  recency?: Recency;
  domains?: string[];
}

export interface SearchOutcome {
  provider: ProviderName;
  hits: SearchHit[];
  /** Providers that failed before this one answered, and why. */
  failed: string[];
}

type Env = Record<string, string | undefined>;
type Provider = (request: SearchRequest, env: Env, options: FetchOptions) => Promise<SearchHit[]>;

const DAYS: Record<Recency, number> = { day: 1, week: 7, month: 31, year: 366 };
const RELIABLE_SEARCH = "set BRAVE_API_KEY, TAVILY_API_KEY, EXA_API_KEY or SEARXNG_URL for a dependable search";

/** The query with its domain filter written into it, for providers without one of their own. */
function siteQuery(request: SearchRequest): string {
  const domains = request.domains ?? [];
  if (domains.length === 0) return request.query;
  const sites = domains.map((domain) => `site:${domain}`);
  return `${request.query} ${sites.length === 1 ? sites[0] : `(${sites.join(" OR ")})`}`;
}

function clean(text: unknown): string {
  return typeof text === "string" ? text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
}

async function json(url: string, options: FetchOptions, provider: string): Promise<unknown> {
  const page = await fetchPage(url, { ...options, accept: "application/json", maxBytes: 2 * 1024 * 1024 });
  if (page.status === 401) throw new Error(`${provider} refused the API key (HTTP 401)`);
  if (page.status === 429) throw new Error(`${provider} is rate limiting (HTTP 429)`);
  if (page.status >= 400) throw new Error(`${provider} answered HTTP ${page.status}: ${clean(page.text).slice(0, 160)}`);
  try {
    return JSON.parse(page.text);
  } catch {
    throw new Error(`${provider} answered with something other than JSON`);
  }
}

const brave: Provider = async (request, env, options) => {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", siteQuery(request));
  url.searchParams.set("count", String(request.limit));
  if (request.recency) url.searchParams.set("freshness", `p${request.recency[0]}`);
  const body = (await json(url.href, { ...options, headers: { "x-subscription-token": env.BRAVE_API_KEY ?? "" } }, "Brave")) as { web?: { results?: Array<Record<string, unknown>> } };
  return (body.web?.results ?? []).map((result) => ({
    title: clean(result.title),
    url: String(result.url ?? ""),
    snippet: clean(result.description),
    ...(result.page_age || result.age ? { date: String(result.page_age ?? result.age) } : {}),
  }));
};

const tavily: Provider = async (request, env, options) => {
  const body = (await json("https://api.tavily.com/search", {
    ...options,
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.TAVILY_API_KEY ?? ""}` },
    body: JSON.stringify({ query: request.query, max_results: request.limit, ...(request.recency ? { time_range: request.recency } : {}), ...(request.domains?.length ? { include_domains: request.domains } : {}) }),
  }, "Tavily")) as { results?: Array<Record<string, unknown>> };
  return (body.results ?? []).map((result) => ({
    title: clean(result.title),
    url: String(result.url ?? ""),
    snippet: clean(result.content).slice(0, 400),
    ...(result.published_date ? { date: String(result.published_date) } : {}),
  }));
};

const exa: Provider = async (request, env, options) => {
  const since = request.recency ? new Date(Date.now() - DAYS[request.recency] * 86_400_000).toISOString() : undefined;
  const body = (await json("https://api.exa.ai/search", {
    ...options,
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.EXA_API_KEY ?? "" },
    body: JSON.stringify({ query: request.query, numResults: request.limit, type: "auto", contents: { text: { maxCharacters: 400 } }, ...(since ? { startPublishedDate: since } : {}), ...(request.domains?.length ? { includeDomains: request.domains } : {}) }),
  }, "Exa")) as { results?: Array<Record<string, unknown>> };
  return (body.results ?? []).map((result) => ({
    title: clean(result.title) || String(result.url ?? ""),
    url: String(result.url ?? ""),
    snippet: clean(result.text).slice(0, 400),
    ...(result.publishedDate ? { date: String(result.publishedDate).slice(0, 10) } : {}),
  }));
};

const searxng: Provider = async (request, env, options) => {
  const url = new URL("search", `${(env.SEARXNG_URL ?? "").replace(/\/?$/, "/")}`);
  url.searchParams.set("q", siteQuery(request));
  url.searchParams.set("format", "json");
  if (request.recency) url.searchParams.set("time_range", request.recency);
  // Your own instance may well be on your own network.
  const body = (await json(url.href, { ...options, allowPrivate: true }, "SearXNG")) as { results?: Array<Record<string, unknown>> };
  return (body.results ?? []).slice(0, request.limit).map((result) => ({
    title: clean(result.title),
    url: String(result.url ?? ""),
    snippet: clean(result.content),
    ...(result.publishedDate ? { date: String(result.publishedDate).slice(0, 10) } : {}),
  }));
};

/** The address a DuckDuckGo result link stands for (its own links go through a redirect). */
function duckTarget(href: string): string | undefined {
  try {
    const url = new URL(href, "https://duckduckgo.com");
    if (url.hostname.endsWith("duckduckgo.com")) {
      if (url.pathname === "/y.js") return undefined; // an ad
      const target = url.searchParams.get("uddg");
      return target ?? undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

/** DuckDuckGo's HTML results as hits. */
export function parseDuckDuckGo(html: string, limit: number): SearchHit[] {
  const root = parseHtml(html);
  const hits: SearchHit[] = [];
  const results = findAll(root, (element) => hasClass(element, "result") && !hasClass(element, "result--ad"));
  for (const result of results) {
    const link = findAll(result, (element) => element.name === "a" && hasClass(element, "result__a"))[0];
    const url = link ? duckTarget(link.attrs.href ?? "") : undefined;
    if (!link || !url || hits.some((hit) => hit.url === url)) continue;
    const snippet = findAll(result, (element) => hasClass(element, "result__snippet"))[0];
    hits.push({ title: textOf(link), url, snippet: snippet ? textOf(snippet) : "" });
    if (hits.length >= limit) break;
  }
  return hits;
}

const duckduckgo: Provider = async (request, _env, options) => {
  const form = new URLSearchParams({ q: siteQuery(request), b: "" });
  if (request.recency) form.set("df", request.recency[0]!);
  const page = await fetchPage("https://html.duckduckgo.com/html/", {
    ...options,
    method: "POST",
    body: form.toString(),
    headers: { "content-type": "application/x-www-form-urlencoded", referer: "https://html.duckduckgo.com/" },
  });
  // Its throttling answers 202 with a challenge page; anything else (a proxy, a firewall) is said as it came.
  if (page.status === 202 || /anomaly-modal|bots use DuckDuckGo too/i.test(page.text)) throw new Error(`DuckDuckGo refused the search (it throttles automated searches; ${RELIABLE_SEARCH})`);
  if (page.status >= 400) throw new Error(`DuckDuckGo answered HTTP ${page.status}${page.text.trim() ? `: ${clean(page.text).slice(0, 160)}` : ""}`);
  return parseDuckDuckGo(page.text, request.limit);
};

const IMPLEMENTATIONS: Record<ProviderName, Provider> = { brave, tavily, exa, searxng, duckduckgo };

/** Providers set up in this environment, best first; DuckDuckGo always last. */
export function configuredProviders(env: Env = process.env): ProviderName[] {
  const keyed: ProviderName[] = [];
  if (env.BRAVE_API_KEY) keyed.push("brave");
  if (env.TAVILY_API_KEY) keyed.push("tavily");
  if (env.EXA_API_KEY) keyed.push("exa");
  if (env.SEARXNG_URL) keyed.push("searxng");
  const chosen = (env.BOT_LOBBY_SEARCH ?? "").trim().toLowerCase();
  const ordered = PROVIDERS.includes(chosen as ProviderName) ? [chosen as ProviderName, ...keyed.filter((name) => name !== chosen)] : keyed;
  return [...new Set([...ordered, "duckduckgo" as const])];
}

/** Search the web with the first provider that answers. Throws when none does. */
export async function searchWeb(request: SearchRequest, options: FetchOptions & { env?: Env } = {}): Promise<SearchOutcome> {
  const env = options.env ?? process.env;
  const failed: string[] = [];
  for (const provider of configuredProviders(env)) {
    try {
      const hits = (await IMPLEMENTATIONS[provider](request, env, options)).filter((hit) => /^https?:\/\//.test(hit.url)).slice(0, request.limit);
      return { provider, hits, failed };
    } catch (error) {
      if (options.signal?.aborted) throw error;
      failed.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`the web search failed. ${failed.join("; ")}`);
}
