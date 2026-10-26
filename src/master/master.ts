import { existsSync, readFileSync, realpathSync } from "node:fs";
import { validateAssignment, type WorkerAssignment } from "../execution/assignment.ts";
import { join, resolve } from "node:path";
import { profileFor, type BotLobbyConfig, type ProfileResolver } from "../schemas/configuration.ts";
import type { Domain } from "../schemas/agent.ts";
import type { AgentRun, ReviewResult, ScoutResult, WorkerResult } from "../schemas/findings.ts";
import { domainSpec } from "../agents/registry.ts";
import { runAgent, watchdogOptions, type AgentRequest } from "../execution/agent-runner.ts";
import { spawnPiProcess, type ProcessRunner, type RelayAsk } from "../execution/pi-runner.ts";
import { knowledgeFilePath, readAgentKnowledge, writeFileEnsured } from "../knowledge/store.ts";
import { taskDir } from "../knowledge/paths.ts";
import { selectKnowledge, selectRelevant, type KnowledgeSelection } from "../knowledge/selector.ts";
import { appendPost, assignmentId } from "../desk/board.ts";
import { refreshCatalogue } from "../knowledge/catalogue.ts";
import { notesFor } from "../knowledge/retrieval.ts";
import { assignmentKey, applySelection, bookmarkBlock, BOOKMARK_DEADLINE_MS, BOOKMARKS_VERSION, deliverBookmarks, fitHints, lexicalBookmarks, type BookmarkState, type Selection } from "../knowledge/bookmarks.ts";
import { KNOWLEDGE_BUDGET_CHARS, type BookmarkPick, type BookmarkSelectorInput, type KnowledgePaths, type KnowledgePicker } from "../classifier/knowledge.ts";
import { scriptsFor } from "../scripts/pick.ts";
import { summarizeOutcomes } from "./synthesis.ts";
import { parseWorkerResult, validateWorkerResult } from "../roles/worker.ts";
import { parseReviewResult, readVerdict, validateReviewResult } from "../roles/reviewer.ts";
import { truncate } from "../text.ts";
import { isScoutResultUsable, parseScoutResult, validateScoutResult } from "../roles/scout.ts";
import { treeState } from "../execution/git.ts";
import { toolBudgetEnv, toolBudgetNote } from "../pi/tool-budget.ts";
import { fileNoteHints, recordFileNotes, treePath, type FileNoteHint } from "../knowledge/file-notes.ts";
import { EvidenceFreshness, verifyEvidenceHint, type EvidenceHint, type EvidenceStatus, type FreshnessInvalidation } from "./evidence-freshness.ts";
import { readCachedScout, scoutKey, writeCachedScout } from "./scout-cache.ts";
import { acquireScoutLock } from "./scout-lock.ts";
import { BOARD_ENV, BOARD_TOOLS, boardContext } from "../desk/board.ts";
import { seedDelivery } from "../desk/delivery.ts";
import type { FileHinter } from "../classifier/files.ts";
import { fellShort, profileLabel, routeLabel, type EffortRoute, type EffortRouter } from "../classifier/effort.ts";

export interface ScoutOutcome {
  result: ScoutResult;
  run: AgentRun;
  issues: string[];
  usable: boolean;
  /** When these findings were taken, if they were reused: the same question on a tree that has not changed since. */
  reused?: string;
}

export interface ScoutRequest {
  taskId: string;
  /** Requirements/objective text used for context selection. */
  taskText: string;
  /** What the Master wants investigated. */
  instruction: string;
  domains: Domain[];
  cwd: string;
  dataRoots: readonly string[];
  taskDir: string;
  config: BotLobbyConfig;
  /** Settings-derived model/thinking/grants, clamped to the model; plain settings when absent. */
  profile?: ProfileResolver;
  signal?: AbortSignal;
  onUpdate?: (run: AgentRun) => void;
  /** Likely files for each scout's context, and the lookup tool, while the classifier's file hints are on. */
  hints?: FileHinter;
  /** Picks the relevant sections of long knowledge files, while the classifier's knowledge picks are on. */
  knowledge?: KnowledgePicker;
  /** Moves a trivial scout to the cheaper model, while the classifier's effort routing is on. */
  effort?: EffortRouter;
}

/** Model, thinking and grants for one run, from settings. */
function profileFields(config: BotLobbyConfig, resolver: ProfileResolver | undefined, domain: Domain, role: AgentRequest["role"]) {
  const profile = profileFor(config, resolver, domain, role);
  return { model: profile.model, mcpTools: profile.mcpTools, ...(profile.skills ? { skills: profile.skills } : {}), ...(profile.autoCompact === false ? { autoCompact: false } : {}), ...(profile.compactAt ? { compactAt: profile.compactAt } : {}), ...(profile.harness ? { harness: profile.harness } : {}), thinking: profile.thinking };
}

function scoutInstruction(request: ScoutRequest, domain: Domain): string {
  return [
    request.instruction,
    "",
    `Domain focus: ${domainSpec(domain).scoutFocus}.`,
    "Investigate the repository and report structured findings. Do not modify any file.",
  ].join("\n");
}

function sharedScoutInstruction(request: ScoutRequest): string {
  if (request.domains.length === 1) return scoutInstruction(request, request.domains[0]!);
  return [
    request.instruction,
    "One shared read-only investigation covers all selected domains; inspect shared code only once.",
    ...request.domains.map((domain) => `${domain}: ${domainSpec(domain).scoutFocus}.`),
    "For each selected domain, emit `# Domain: <domain>` followed by the usual scout sections. Attribute evidence to that domain; do not omit domains.",
    "Identify relevant files with line anchors and purposes, contracts, callers, tests and risks. Distinguish verified evidence from assumptions. Do not modify any file.",
  ].join("\n\n");
}

/** Where an agent's knowledge files are, for the note that says what a prompt left out. */
function knowledgePaths(dataRoots: readonly string[], agent: Domain): KnowledgePaths {
  const root = dataRoots[0];
  return root ? { knowledge: knowledgeFilePath(root, agent, "knowledge"), standards: knowledgeFilePath(root, agent, "standard"), decisions: knowledgeFilePath(root, agent, "decision") } : {};
}

/**
 * What an agent's prompt carries of its knowledge for a step: Jev's picks from
 * the files that are too long when a picker is given, the keyword selection
 * otherwise and whenever the picker fails; and the shared scripts that fit it.
 */
/** Retrieval mode replaces the historical knowledge and decision dumps with assignment bookmarks; standards stay direct. */
function retrievalMode(request: { config?: BotLobbyConfig }): boolean {
  return request.config?.workflow.knowledgeRetrieval !== false && request.config !== undefined;
}

async function pickKnowledge(request: { config?: BotLobbyConfig; knowledge?: KnowledgePicker; dataRoots: readonly string[]; signal?: AbortSignal }, agent: Domain, query: string): Promise<KnowledgeSelection> {
  const [selected, scripts] = await Promise.all([pickFiles(request, agent, query), scriptsFor(request.dataRoots[0], query, request.knowledge?.scripts, request.signal)]);
  return scripts ? { ...selected, scripts } : selected;
}

async function pickFiles(request: { config?: BotLobbyConfig; knowledge?: KnowledgePicker; dataRoots: readonly string[]; signal?: AbortSignal }, agent: Domain, query: string): Promise<KnowledgeSelection> {
  const slices = readAgentKnowledge(request.dataRoots, agent);
  if (retrievalMode(request)) {
    return { knowledge: "", decisions: "", standards: selectRelevant(query, slices.standards ?? "", KNOWLEDGE_BUDGET_CHARS) };
  }
  if (!request.knowledge) return selectKnowledge(query, slices);
  try {
    return await request.knowledge.select(query, slices, { paths: knowledgePaths(request.dataRoots, agent), ...(request.signal ? { signal: request.signal } : {}) });
  } catch {
    return selectKnowledge(query, slices);
  }
}

/** Resolve with the value, or `fallback` once `ms` pass: bookmark preparation never blocks the step. */
async function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** The lexical picks as the bookmark list records them. */
function lexicalPicks(input: BookmarkSelectorInput): BookmarkPick[] {
  return lexicalBookmarks(input.assignment, input.entries).map((pick) => ({ ...pick, source: "lexical" as const }));
}

/** Post a bookmark's correction signals to the task board as oracle notes; the delivered mark says verify regardless. */
function postCorrections(board: string | undefined, corrections: readonly string[]): void {
  for (const text of corrections) {
    try {
      appendPost(board!, { from: "oracle", kind: "note", text });
    } catch {
      // No board (or it is busy): the delivered bookmark still carries its changed/stale mark.
    }
  }
}

/**
 * Select and deliver one recipient's assignment bookmarks: bounded catalogue
 * metadata in, at most eight references out (the classifier's picks, or the
 * lexical fallback when it is off, slow or failing), persisted in the task's
 * storage, revalidated at delivery, rendered within the 3,000-character
 * metadata budget. Returns "" in legacy mode; a coverage line when nothing
 * was selected, so the agent knows the retrieval tools are there.
 */
async function prepareBookmarks(
  request: { taskId: string; cwd: string; dataRoots: readonly string[]; config: BotLobbyConfig; knowledge?: KnowledgePicker; board?: string; signal?: AbortSignal },
  recipient: string,
  query: string,
): Promise<string> {
  const dir = request.dataRoots[0];
  if (!request.config.workflow.knowledgeRetrieval || !dir) return "";
  const { catalogue, coverage } = refreshCatalogue(request.dataRoots);
  const input: BookmarkSelectorInput = {
    assignment: query,
    entries: catalogue.entries.filter((entry) => entry.freshness !== "stale"),
    catalogueRevision: catalogue.revision,
    cacheKey: `${request.taskId}:${recipient}`,
    ...(request.signal ? { signal: request.signal } : {}),
  };
  const picks = request.knowledge?.bookmarks
    ? await within(request.knowledge.bookmarks.select(input), BOOKMARK_DEADLINE_MS + 500, lexicalPicks(input))
    : lexicalPicks(input);
  const selections: Selection[] = picks.map(({ ref, reason, revision }) => ({ ref, reason, revision }));
  const authority = picks.some((pick) => pick.source === "classifier") ? "classifier" : "lexical";
  const state = bookmarkState(dir, request, recipient, query, catalogue.revision, selections, authority);
  const access = { dataRoots: request.dataRoots, cwd: request.cwd };
  const notes = notesFor(dir);
  postCorrections(request.board, deliverBookmarks(state, recipient, catalogue, access, notes).corrections);
  return bookmarkBlock(state, recipient, catalogue, access, notes) || `No bookmarks were selected for this assignment (catalogue coverage: ${coverage}); search_knowledge finds the recorded knowledge.`;
}

/** The persisted bookmark list after this selection; a busy list still delivers this run's picks. */
function bookmarkState(
  dir: string,
  request: { taskId: string },
  recipient: string,
  query: string,
  sourceRevision: number,
  selections: Selection[],
  authority: "classifier" | "lexical",
): BookmarkState {
  try {
    return applySelection(dir, request.taskId, recipient, assignmentKey(query), sourceRevision, selections, authority);
  } catch {
    return {
      version: BOOKMARKS_VERSION, taskId: request.taskId, assignment: assignmentKey(query), sourceRevision,
      records: selections.map((pick) => ({ ref: pick.ref, recipient, authority, reason: pick.reason, sourceVersion: `${sourceRevision}`, revision: pick.revision, at: new Date().toISOString() })),
    };
  }
}

function scoutContext(request: ScoutRequest, domain: Domain, selected: KnowledgeSelection, likely = "", bookmarks = ""): AgentRequest["context"] {
  return {
    task: request.taskText,
    ...selected,
    ...(bookmarks ? { bookmarks } : {}),
    instructions: request.config.agents[domain].instructions,
    workflowContext: [`Task state: scouting. Domain: ${domain}. Read-only reconnaissance; no implementation.`, toolBudgetNote(request.config.scout.maxToolCalls), likely].filter(Boolean).join("\n\n"),
  };
}

/** Where the classifier routes a run, or undefined (no router, no route, a failure). */
async function routeFor(effort: EffortRouter | undefined, instruction: string, profile: { model?: string; thinking: string }, options: { thinkingFixed?: boolean; context?: string; signal?: AbortSignal }): Promise<EffortRoute | undefined> {
  if (!effort) return undefined;
  try {
    return await effort.route(instruction, profile, options);
  } catch {
    return undefined;
  }
}

/** The run fields a route changes: model, thinking, no in-place retry (the fallback is the retry), and its label. */
function routedFields(route: EffortRoute): Pick<AgentRequest, "model" | "thinking" | "retries" | "routedFrom" | "route"> {
  return { model: route.model, thinking: route.thinking, retries: 0, routedFrom: profileLabel(route.from), route: routeLabel(route) };
}

/** The Likely files block for one agent's step, or "" without hints. */
async function likelyFor(hints: FileHinter | undefined, query: string, signal: AbortSignal | undefined, context?: string): Promise<string> {
  if (!hints) return "";
  try {
    return await hints.block(query, signal, context);
  } catch {
    return "";
  }
}

function toOutcome(run: AgentRun, domain: Domain): ScoutOutcome {
  if (run.status !== "success") {
    return {
      result: parseScoutResult(domain, run.output),
      run,
      issues: [`scout ${run.status}: ${run.error ?? "no detail"}`],
      usable: false,
    };
  }
  const result = parseScoutResult(domain, run.output);
  return { result, run, issues: validateScoutResult(result), usable: isScoutResultUsable(result) };
}

/** One preparation/execution per task, including targeted followups. No cache miss implicitly invokes this API. */
export async function runScouts(request: ScoutRequest, run: ProcessRunner = spawnPiProcess): Promise<ScoutOutcome[]> {
  const release = acquireScoutLock(request.taskDir);
  try {
    return await prepareScouts({ ...request, domains: [...new Set(request.domains)] }, run);
  } finally {
    release();
  }
}

async function prepareScouts(request: ScoutRequest, run: ProcessRunner): Promise<ScoutOutcome[]> {
  if (request.domains.length === 0) return [];
  request.signal?.throwIfAborted();
  const dataDir = request.dataRoots[0];
  const tree = dataDir && request.config.workflow.reuseScouts ? await treeState(request.cwd, request.dataRoots) : undefined;
  const instruction = sharedScoutInstruction(request);
  const keys = request.domains.map((domain) => scoutKey(domain, instruction, request.taskText));
  const cached = keys.map((key) => (dataDir && tree ? readCachedScout(dataDir, key, tree) : undefined));
  // Never mix execution identities from a partially cached preparation.
  const outcomes = cached.every((outcome) => outcome !== undefined && outcome.run.runId === cached[0]?.run.runId)
    ? cached as ScoutOutcome[] : await scoutDomains(request, run);
  saveScoutResults(request.taskDir, outcomes);
  if (dataDir) await remember(dataDir, request, outcomes, keys, tree);
  return outcomes;
}

/** Keep what new scouts found: their answers for reuse while the tree is as it was, their files' notes for the map. */
async function remember(dataDir: string, request: ScoutRequest, outcomes: readonly ScoutOutcome[], keys: readonly string[], tree: string | undefined): Promise<void> {
  const found = outcomes.map((outcome, index) => ({ outcome, key: keys[index]! })).filter(({ outcome }) => !outcome.reused && outcome.usable);
  if (found.length === 0) return;
  // Scouts only read: a tree that changed meanwhile was changed by someone else, and their answers may not match it.
  if (tree && (await treeState(request.cwd, request.dataRoots)) === tree) {
    for (const { outcome, key } of found) writeCachedScout(dataDir, key, tree, outcome);
  }
  await Promise.all(found.map(({ outcome }) => recordFileNotes(dataDir, request.cwd, outcome.result.domain, outcome.result.relevantFiles).catch(() => 0)));
}

async function scoutDomains(request: ScoutRequest, run: ProcessRunner): Promise<ScoutOutcome[]> {
  const entry = await sharedScoutRequest(request);
  const route = entry.harness ? undefined : await routeFor(request.effort, entry.instruction, { ...(entry.model ? { model: entry.model } : {}), thinking: entry.thinking ?? "low" }, { thinkingFixed: true, context: request.taskText, ...(request.signal ? { signal: request.signal } : {}) });
  let agentRun = await runAgent(route ? { ...entry, ...routedFields(route) } : entry, run);
  let outcomes = sharedScoutOutcomes(agentRun, request.domains);
  if (route && outcomes.some((outcome) => !outcome.usable) && agentRun.status !== "cancelled" && !request.signal?.aborted) {
    agentRun = await runAgent(entry, run);
    outcomes = sharedScoutOutcomes(agentRun, request.domains);
  }
  return outcomes;
}

async function sharedScoutRequest(request: ScoutRequest): Promise<AgentRequest> {
  const domain = request.domains[0]!;
  const instruction = sharedScoutInstruction(request);
  const query = `${instruction}\n\n${request.taskText}`;
  const [likely, selections, bookmarked] = await Promise.all([
    likelyFor(request.hints, instruction, request.signal, request.taskText),
    Promise.all(request.domains.map((selected) => pickKnowledge(request, selected, query))),
    prepareBookmarks(request, request.domains.length === 1 ? domain : `scout:${request.domains.join("+")}`, query),
  ]);
  const hints = fitHints(bookmarked, likely);
  return {
    delegationQuota: { used: 0 }, effort: request.effort, taskId: request.taskId, domain, role: "scout",
    instruction, context: sharedScoutContext(request, selections, hints), extraTools: request.hints?.tools() ?? [], env: toolBudgetEnv(request.config.scout.maxToolCalls),
    ...profileFields(request.config, request.profile, domain, "scout"),
    cwd: request.cwd, signal: request.signal, onUpdate: request.onUpdate, ...watchdogOptions(request.config.workflow),
  };
}

function sharedScoutContext(request: ScoutRequest, selections: KnowledgeSelection[], hints: { likely: string; bookmarks: string }): AgentRequest["context"] {
  const selected = mergeScoutKnowledge(request.domains, selections);
  const context = scoutContext(request, request.domains[0]!, selected, hints.likely, hints.bookmarks);
  context.instructions = request.domains.map((domain) => request.config.agents[domain].instructions ? `${domain}: ${request.config.agents[domain].instructions}` : "").filter(Boolean).join("\n\n");
  context.workflowContext += `\nSelected domains: ${request.domains.join(", ")}. One shared scout; keep evidence attributed to each domain.`;
  return context;
}

function mergeScoutKnowledge(domains: Domain[], selections: KnowledgeSelection[]): KnowledgeSelection {
  if (selections.length === 1) return selections[0]!;
  const merge = (key: keyof KnowledgeSelection) => selections.map((selected, index) => selected[key] ? `### ${domains[index]}\n${selected[key]}` : "").filter(Boolean).join("\n\n");
  return { knowledge: merge("knowledge"), standards: merge("standards"), decisions: merge("decisions"), scripts: merge("scripts") };
}

/** Domain projections retain the original execution object: usage/work events are emitted only once. */
function sharedScoutOutcomes(run: AgentRun, domains: Domain[]): ScoutOutcome[] {
  if (domains.length === 1) return [toOutcome(run, domains[0]!)];
  const sections = run.output.split(/^# Domain: (designer|backend|qa)\s*$/m);
  return domains.map((domain) => {
    const index = sections.findIndex((value, index) => index % 2 === 1 && value === domain);
    const raw = index < 0 ? "" : sections[index + 1] ?? "";
    const outcome = toOutcome({ ...run, output: raw }, domain);
    return { ...outcome, run, issues: index < 0 ? [...outcome.issues, `missing shared scout section for ${domain}`] : outcome.issues };
  });
}
export function scoutResultPath(taskDir: string, domain: Domain): string {
  return join(taskDir, `scout-${domain}.json`);
}

export function saveScoutResults(taskDir: string, outcomes: ScoutOutcome[]): void {
  for (const outcome of outcomes) {
    writeFileEnsured(scoutResultPath(taskDir, outcome.result.domain), JSON.stringify(outcome, null, 2));
  }
}

/** Re-read persisted scout findings for the given domains; the first dir with a file wins. */
export function loadScoutResults(taskDirs: string | readonly string[], domains: Domain[]): ScoutOutcome[] {
  const dirs = typeof taskDirs === "string" ? [taskDirs] : taskDirs;
  const outcomes: ScoutOutcome[] = [];
  for (const domain of domains) {
    const found = readScoutArtifact(dirs, domain);
    if (found) outcomes.push(found);
  }
  return outcomes;
}

function readScoutArtifact(dirs: readonly string[], domain: Domain): ScoutOutcome | undefined {
  for (const dir of dirs) {
    const path = scoutResultPath(dir, domain);
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as ScoutOutcome;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export interface WorkerFreshness {
  assignmentId: string;
  revision: number;
  status: EvidenceStatus;
  hintIds: string[];
  hints?: EvidenceHint[];
  pause?: true;
  recheckCompletedWork?: boolean;
}

export interface WorkerOutcome {
  result: WorkerResult;
  run: AgentRun;
  issues: string[];
  freshness?: WorkerFreshness;
}

export interface WorkerRequest {
  /** Optional until the installed runtime supports fail-closed revised loadouts. */
  assignment?: WorkerAssignment;
  /** Existing task status can expose background hint verification without a preparation gate. */
  onFreshness?: (status: WorkerFreshness) => void;
  /** Extra run wiring for parallel batches: the file desk's env, tools and hooks. */
  agent?: Pick<AgentRequest, "env" | "extraTools" | "onStart" | "onAttemptEnd">;
  taskId: string;
  domain: Domain;
  /** What the Master wants implemented. */
  instruction: string;
  /** Requirements + approved objective + approved plan. */
  taskText: string;
  scoutOutcomes: ScoutOutcome[];
  cwd: string;
  dataRoots: readonly string[];
  config: BotLobbyConfig;
  /** Settings-derived model/thinking/grants, clamped to the model; plain settings when absent. */
  profile?: ProfileResolver;
  signal?: AbortSignal;
  onUpdate?: (run: AgentRun) => void;
  /** Likely files for the worker's step, and the lookup tool, while the classifier's file hints are on. */
  hints?: FileHinter;
  /** Picks the relevant sections of long knowledge files, while the classifier's knowledge picks are on. */
  knowledge?: KnowledgePicker;
  /** Lowers thinking (or the model) for a step the classifier judges simple or trivial. */
  effort?: EffortRouter;
  /** The worker may ask the user (the designer): its questions are relayed, and its images saved in `previews`. */
  ask?: { onAsk: RelayAsk; previews: string };
  /** A QA step's verification budget: Jev's QA risk read of the change so far. */
  risk?: string;
  /** The task board's file: the worker reads what its role follows and posts contracts, decisions and blockers. */
  board?: string;
  /** The worker's board identity (`backend:9f2c1e`): one per assignment, so two same-role workers never share delivery state. Minted when omitted. */
  boardFrom?: string;
  /** Domains working at the same time as this one, in a parallel batch. */
  alongside?: readonly Domain[];
}

/** How a worker uses the task board, and what it already says for its role. */
function boardGuidance(request: WorkerRequest, reader: string): string {
  if (!request.board) return "";
  // The board lines below are a delivery: record them before any push can race the read.
  seedDelivery(request.board, reader);
  return [
    "Task board: post with `post_board` whenever you settle something another agent builds against or must follow (`contract`: a route, payload, type, event or file location; `decision`), when you are blocked on someone else's part (`blocker`), and when a piece is finished and testable (`done`). Exact facts in a line or two; no progress chatter. `read_board` shows what the others posted; `ack_board` records the events you actually incorporated — reading alone does not.",
    boardContext(request.board, reader),
  ].filter(Boolean).join("\n\n");
}

/** What a worker in a parallel batch is told about the others, and QA about testing alongside the build. */
function alongsideGuidance(request: WorkerRequest): string {
  const others = (request.alongside ?? []).filter((domain) => domain !== request.domain);
  if (others.length === 0) return "";
  const names = others.map((domain) => ({ backend: "DEV", designer: "DESIGN", qa: "QA" })[domain]).join(" and ");
  const peers = `You work at the same time as ${names}. Settle what they build against through the board's \`contract\` posts, and read theirs before you guess.`;
  if (request.domain !== "qa") return peers;
  return [
    peers,
    "You write the tests while the others build, so nobody waits for the build to finish first: work from the approved plan's contracts and acceptance criteria and the board's `contract` posts, not from their code. Write and claim test files only. When a builder posts `done` for a piece (or before you report), run your tests against what is there; a failing test against finished work is a finding for its owner, never a production fix of yours.",
  ].join(" ");
}

/** What a worker that may ask the user is told about it. */
function askGuidance(previews: string): string {
  return [
    "You can ask the user with ask_user_question: the oracle relays it, and your clock stops while they answer.",
    "Ask when a design decision is genuinely theirs (a visual direction, a layout, a style), once, with all such questions together, before you build it; decide everything else yourself.",
    "Show each option. Give it a `preview`: a Markdown wireframe (a fenced block drawn with box characters) or a short snippet of the component.",
    `When you can render an option (a screenshot from the project's own tooling, a rendered mockup), save it as a PNG under ${previews} (never in the repository) and give its path as the option's \`image\`.`,
    "Put the option you recommend first. The answers are recorded as the task's decisions: build what the user chose.",
  ].join(" ");
}

function workerWorkflowContext(request: WorkerRequest, boardFrom: string, likely = ""): string {
  const spec = domainSpec(request.domain);
  const own = request.scoutOutcomes.filter(
    (outcome) => outcome.result.domain === request.domain && outcome.usable,
  );
  return [
    `Task state: implementing. Domain: ${request.domain}.`,
    `Domain boundary: ${spec.boundary}`,
    "Dependency policy: never add a dependency or make a significant architectural change yourself; list them under the matching output section and stop that part of the work.",
    own.length > 0
      ? `${request.assignment ? "Unverified broad scout navigation hints only; repository freshness is not established. Re-read current assigned files and verify callers/tests rather than relying on these findings." : "Scout findings for your domain:"}\n${summarizeOutcomes(own, 1500)}`
      : "No scout findings were collected for your domain; verify the repository yourself.",
    likely,
    request.risk ?? "",
    alongsideGuidance(request),
    boardGuidance(request, boardFrom),
    request.ask ? askGuidance(request.ask.previews) : "",
    request.dataRoots[0] ? `Scripts you draft for the shared library go in \`${join(taskDir(request.dataRoots[0], request.taskId), "scripts")}\`.` : "",
    request.dataRoots[0] ? `Long findings (an investigation, a list of call sites, a log excerpt) go in a file under \`${join(taskDir(request.dataRoots[0], request.taskId), "notes")}\`: give its path under Notes instead of pasting them into your report, so whoever needs them reads them whole.` : "",
  ].filter(Boolean).join("\n\n");
}

interface TaskFreshness {
  checks: EvidenceFreshness;
  listeners: Map<string, (event: FreshnessInvalidation) => void>;
}

// Only overlapping dispatches share checks; no persistent evidence verdict cache.
const workerFreshness = new Map<string, TaskFreshness>();

function taskFreshness(key: string, request: WorkerRequest): TaskFreshness {
  const existing = workerFreshness.get(key);
  if (existing) return existing;
  const listeners = new Map<string, (event: FreshnessInvalidation) => void>();
  const checks = new EvidenceFreshness(
    (hint) => verifyEvidenceHint(request.cwd, hint, () => treeState(request.cwd, request.dataRoots)),
    (event) => listeners.get(JSON.stringify([event.assignmentId, event.revision]))?.(event),
  );
  const state = { checks, listeners };
  workerFreshness.set(key, state);
  return state;
}

function freshnessHints(hints: readonly FileNoteHint[]): string {
  if (!hints.length) return "";
  return [
    "Unverified hints (file-local navigation only; not current callers, tests or repository behavior). Read assigned files now; checks run alongside this work.",
    ...hints.map((hint) => `${hint.id}: ${hint.source} — ${hint.note.note}`),
    "If a hint is invalidated, pause only work depending on it, continue independent assigned work, and request corrected evidence/revision. Completed dependent work must be rechecked before acceptance.",
  ].join("\n");
}

function reportFreshness(request: WorkerRequest, reader: string, status: WorkerFreshness): void {
  request.onFreshness?.(status);
  if (!request.board) return;
  appendPost(request.board, {
    from: "oracle", kind: status.pause ? "blocker" : "note", to: ["oracle", reader],
    text: `Assignment ${status.assignmentId} revision ${status.revision}: ${status.status}. Hints: ${status.hintIds.join(", ") || "none"}.${status.pause ? " Pause only dependent work; continue independent assigned work. Recheck completed dependent work before acceptance; request corrected evidence in a new revision." : " File-local navigation only; use current assigned-file reads."}`,
  });
}

/** True when an assignment only reads: every file is reference and no edit or write tool is selected. */
export function readOnlyAssignment(assignment: WorkerAssignment): boolean {
  return assignment.files.every((file) => file.access === "reference") && !assignment.tools.some((tool) => tool.name === "edit" || tool.name === "write");
}

/**
 * The worker's model, thinking and grants. A read-only assignment needs no
 * builder: it runs on the scout's model and thinking (keeping the worker's grants,
 * which its tool selection was checked against), unless the scout is on a harness.
 */
function workerProfile(request: WorkerRequest, assignment: WorkerAssignment | undefined) {
  const worker = profileFields(request.config, request.profile, request.domain, "worker");
  if (!assignment || !request.config.workflow.readOnlyOnScoutModel || !readOnlyAssignment(assignment)) return worker;
  const scout = profileFields(request.config, request.profile, request.domain, "scout");
  if (scout.harness || worker.harness) return worker;
  // A scout that inherits the session's model would make this run dearer: keep the worker's model, at the scout's thinking.
  const model = scout.model && scout.model !== "inherit" ? scout.model : worker.model;
  return { ...worker, model, thinking: scout.thinking };
}

/** Delegate one implementation step to a domain worker. */
export async function runWorker(
  request: WorkerRequest,
  run: ProcessRunner = spawnPiProcess,
): Promise<WorkerOutcome> {
  const assignment = request.assignment !== undefined ? await validateAssignment(request.assignment, request.cwd) : undefined;
  if (assignment && !request.dataRoots[0]) throw new Error("Assigned worker requires host-owned task storage in dataRoots.");
  const configured = workerProfile(request, assignment);
  const [selected, likely, route, bookmarked] = await Promise.all([
    pickKnowledge(request, request.domain, `${request.instruction}\n\n${request.taskText}`),
    assignment ? Promise.resolve("") : likelyFor(request.hints, request.instruction, request.signal, request.taskText),
    routeFor(request.effort, request.instruction, { ...(configured.model ? { model: configured.model } : {}), thinking: configured.thinking }, { context: request.taskText, ...(request.signal ? { signal: request.signal } : {}) }),
    prepareBookmarks(request, request.domain, `${request.instruction}\n\n${request.taskText}`),
  ]);
  const hints = fitHints(bookmarked, likely);
  const hintTools = request.hints?.tools() ?? [];
  const boardFrom = request.boardFrom ?? assignmentId(request.domain);
  const extraTools = [...(request.agent?.extraTools ?? []), ...hintTools, ...(request.board ? BOARD_TOOLS : [])];
  const env = request.board ? { ...request.agent?.env, [BOARD_ENV]: request.board, BOT_LOBBY_BOARD_FROM: boardFrom } : request.agent?.env;
  const base: AgentRequest = {
    delegationQuota: { used: 0 },
    ...(assignment ? { assignment: { brief: assignment, taskDir: taskDir(request.dataRoots[0]!, request.taskId) } } : {}),
    effort: request.effort,
    effortProfile: configured,
    taskId: request.taskId,
    domain: request.domain,
    role: "worker",
    instruction: request.instruction,
    context: {
      task: request.taskText,
      ...selected,
      ...(hints.bookmarks ? { bookmarks: hints.bookmarks } : {}),
      instructions: request.config.agents[request.domain].instructions,
      workflowContext: workerWorkflowContext(request, boardFrom, hints.likely),
    },
    ...configured,
    cwd: request.cwd,
    signal: request.signal,
    onUpdate: request.onUpdate,
    ...watchdogOptions(request.config.workflow),
    ...request.agent,
    ...(env ? { env } : {}),
    ...(extraTools.length > 0 ? { extraTools } : {}),
    ...(request.ask ? { onAsk: request.ask.onAsk } : {}),
  };
  if (assignment) return runFreshWorker(request, assignment, base, route, boardFrom, run);
  let outcome = workerOutcome(request.domain, await runAgent(route ? { ...base, ...routedFields(route) } : base, run), request.cwd, assignment);
  // A routed step that fell short runs again at the configured model and thinking.
  if (route && fellShort(outcome.run, outcome.issues) && !request.signal?.aborted) {
    const routed = outcome.run.edited ?? [];
    outcome = workerOutcome(request.domain, await runAgent(base, run), request.cwd, assignment);
    // The step owns what the routed attempt edited too.
    const edited = [...new Set([...routed, ...(outcome.run.edited ?? [])])];
    if (edited.length > 0) outcome = { ...outcome, run: { ...outcome.run, edited } };
  }
  return outcome;
}

async function runFreshWorker(request: WorkerRequest, assignment: WorkerAssignment, base: AgentRequest, route: EffortRoute | undefined, reader: string, run: ProcessRunner): Promise<WorkerOutcome> {
  const key = JSON.stringify([request.cwd, taskDir(request.dataRoots[0]!, request.taskId)]);
  const state = taskFreshness(key, request);
  const listenerKey = JSON.stringify([assignment.id, assignment.revision]);
  if (state.listeners.has(listenerKey)) throw new Error("Assignment revision is already checking freshness; wait for its dispatch to finish.");
  const hints = fileNoteHints(request.dataRoots[0]!, assignment.files.flatMap((file) => {
    const path = treePath(request.cwd, file.path);
    return path ? [path] : [];
  }));
  const status = (): WorkerFreshness => {
    const current = state.checks.status(assignment.id, assignment.revision);
    return { assignmentId: assignment.id, revision: assignment.revision, status: current, hintIds: hints.map((hint) => hint.id), hints: hints.map(({ id, scope, source, fingerprint }) => ({ id, scope, source, fingerprint })), ...(current === "invalidated" ? { pause: true as const, recheckCompletedWork: true } : {}) };
  };
  state.listeners.set(listenerKey, (event) => reportFreshness(request, reader, { ...status(), ...event }));
  let checkError: unknown;
  let checking: Promise<void> | undefined;
  try {
    checking = state.checks.start({ assignmentId: assignment.id, revision: assignment.revision, hints }).catch((error: unknown) => { checkError = error; });
    if (assignment.completedWork.length) state.checks.completed(assignment.id, assignment.revision);
    reportFreshness(request, reader, status());
    const instruction = [base.instruction, freshnessHints(hints)].filter(Boolean).join("\n\n");
    // Assignment-local navigation hints belong in user content, not the shared system prefix.
    // Start actual dispatch now, before awaiting any source-file hashes.
    const outcome = await dispatchFreshWorker({ ...base, instruction }, request, assignment, route, state.checks, run);
    state.checks.completed(assignment.id, assignment.revision);
    await checking;
    const freshness = status();
    if (freshness.status !== "superseded") reportFreshness(request, reader, freshness);
    const issues = state.checks.canAccept(assignment.id, assignment.revision) && !checkError ? outcome.issues : [...outcome.issues, `Assignment evidence ${freshness.status}; acceptance requires current verified hints and rechecked dependent work.${checkError ? " Freshness notification failed; restore task status/board delivery before retrying." : ""}`];
    return { ...outcome, issues, freshness };
  } finally {
    await checking;
    state.checks.completed(assignment.id, assignment.revision);
    state.listeners.delete(listenerKey);
    if (!state.listeners.size) workerFreshness.delete(key);
  }
}

async function dispatchFreshWorker(base: AgentRequest, request: WorkerRequest, assignment: WorkerAssignment, route: EffortRoute | undefined, checks: EvidenceFreshness, run: ProcessRunner): Promise<WorkerOutcome> {
  const outcome = workerOutcome(request.domain, await runAgent(route ? { ...base, ...routedFields(route) } : base, run), request.cwd, assignment);
  if (!route || !fellShort(outcome.run, outcome.issues) || request.signal?.aborted || ["invalidated", "superseded"].includes(checks.status(assignment.id, assignment.revision))) return outcome;
  const edited = outcome.run.edited ?? [];
  const retry = await runAgent(base, run);
  const combined = [...new Set([...edited, ...(retry.edited ?? [])])];
  return workerOutcome(request.domain, { ...retry, edited: combined }, request.cwd, assignment);
}

function workerOutcome(domain: Domain, agentRun: AgentRun, cwd: string, assignment?: WorkerAssignment): WorkerOutcome {
  const result = parseWorkerResult(domain, agentRun.output);
  const issues =
    agentRun.status === "success"
      ? validateWorkerResult(result, assignment)
      : [`worker ${agentRun.status}: ${agentRun.error ?? "no detail"}`];
  if (assignment && agentRun.edited?.length) {
    const root = realpathSync(cwd);
    const writable = new Set(assignment.files.filter((file) => file.access !== "reference").map((file) => resolve(root, file.path)));
    for (const path of agentRun.edited) {
      if (!writable.has(resolve(root, path))) issues.push(`observed edit outside assignment edit/create paths: ${path}`);
    }
    if (!result.verification.trim() && !issues.includes("changed files without verification")) issues.push("changed files without verification");
  }
  return { result, run: agentRun, issues };
}

export interface ReviewerOutcome {
  result: ReviewResult;
  run: AgentRun;
  issues: string[];
}

export interface ReviewerRequest {
  effort?: EffortRouter;
  taskId: string;
  domain: Domain;
  taskText: string;
  workerSummary: string;
  scoutOutcomes: ScoutOutcome[];
  diff: string;
  /** Who changed each changed file (planned, lobby chat, pre-existing, …), one line each. */
  provenance?: string;
  /** What the previous QA round asked for, when there was one: this round verifies it. */
  previousRound?: string;
  /** The engine's lint result on the touched files and the suppressions the task added. */
  lint?: string;
  /** Jev's QA risk read of the change: the gate's depth, test budget and focus. */
  risk?: string;
  /** The task board's contracts, decisions, blockers and finished pieces, as posted by the task's agents. */
  board?: string;
  /** The assignments behind the change: the files each could change and its verification commands, for QA to start from. */
  assignmentChecks?: string;
  /** Review with a clean context: no worker summaries or scout findings, only the request, plan, board and diff. */
  clean?: boolean;
  instruction?: string;
  cwd: string;
  dataRoots: readonly string[];
  config: BotLobbyConfig;
  /** Settings-derived model/thinking/grants, clamped to the model; plain settings when absent. */
  profile?: ProfileResolver;
  signal?: AbortSignal;
  onUpdate?: (run: AgentRun) => void;
  /** Picks the relevant sections of long knowledge files, while the classifier's knowledge picks are on. */
  knowledge?: KnowledgePicker;
}

function reviewerContext(request: ReviewerRequest): string {
  const owns = request.scoutOutcomes.filter(
    (outcome) => outcome.result.domain === request.domain && outcome.usable,
  );
  return [
    `Task state: reviewing. Domain: ${request.domain}.`,
    "You may not modify implementation. Report required changes instead.",
    request.risk ?? "",
    request.previousRound ?? "",
    request.clean
      ? "You review with a clean context: the request, the approved plan, the task board and the diff, not the workers' own accounts of what they did. Judge the change by what the code does, and verify any claim yourself before you rely on it."
      : request.workerSummary ? `Worker summary (each domain's newest entries):\n${truncate(request.workerSummary, 4800)}` : "No worker summary available.",
    // QA scouts planned these tests: their findings are the reviewer's own groundwork, not a worker's account.
    owns.length > 0 ? `Scout findings:\n${summarizeOutcomes(owns, 1200)}` : "",
    request.provenance ? `Who changed each file (bot-lobby's record of every agent's edit and write calls; judge each as your role's Change provenance says):\n${request.provenance}` : "",
    request.lint ?? "",
    request.board ?? "",
    request.assignmentChecks ?? "",
    `Repository changes:\n${request.diff}`,
  ]
    .filter((line) => line.length > 0)
    .join("\n\n");
}

/** True when a verdict can be read from the output (the contract's heading, or a line naming it). */
export function hasReviewVerdict(text: string): boolean {
  return readVerdict(text) !== undefined;
}

/** A success without the Verdict section is off-contract and worth resampling. */
function isRetryableReviewRun(run: AgentRun): boolean {
  return run.status !== "cancelled" && (run.status !== "success" || !hasReviewVerdict(run.output));
}

function reviewerAgentRequest(request: ReviewerRequest, selected: KnowledgeSelection, bookmarks = ""): AgentRequest {
  return {
    taskId: request.taskId,
    domain: request.domain,
    role: "reviewer",
    effort: request.effort,
    instruction:
      request.instruction?.trim() ||
      "Review the current repository changes against the approved requirements and plan.",
    context: {
      task: request.taskText,
      ...selected,
      ...(bookmarks ? { bookmarks } : {}),
      instructions: request.config.agents[request.domain].instructions,
      workflowContext: reviewerContext(request),
    },
    ...profileFields(request.config, request.profile, request.domain, "reviewer"),
    cwd: request.cwd,
    signal: request.signal,
    onUpdate: request.onUpdate,
    ...watchdogOptions(request.config.workflow),
    retries: 0,
  };
}

function reviewerIssues(run: AgentRun, result: ReviewResult): string[] {
  return run.status === "success"
    ? validateReviewResult(result)
    : [`reviewer ${run.status}: ${run.error ?? "no detail"}`];
}

/** Independently review the current repository state for one domain. */
export async function runReviewer(
  request: ReviewerRequest,
  run: ProcessRunner = spawnPiProcess,
): Promise<ReviewerOutcome> {
  const query = `${request.taskText} ${request.workerSummary}`;
  const [selected, bookmarked] = await Promise.all([
    pickKnowledge(request, request.domain, query),
    prepareBookmarks(request, request.domain, query),
  ]);
  const agentRequest = reviewerAgentRequest(request, selected, bookmarked);
  const attempts = Math.max(1, request.config.workflow.maxAgentRetries + 1);
  let agentRun = await runAgent(agentRequest, run);
  for (let attempt = 2; attempt <= attempts && isRetryableReviewRun(agentRun); attempt++) {
    agentRun = await runAgent(agentRequest, run);
  }
  const result = parseReviewResult(request.domain, agentRun.output);
  return { result, run: agentRun, issues: reviewerIssues(agentRun, result) };
}
