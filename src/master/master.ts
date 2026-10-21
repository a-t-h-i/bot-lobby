import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { profileFor, type BotLobbyConfig, type ProfileResolver } from "../schemas/configuration.ts";
import type { Domain } from "../schemas/agent.ts";
import type { AgentRun, ReviewResult, ScoutResult, WorkerResult } from "../schemas/findings.ts";
import { domainSpec } from "../agents/registry.ts";
import { runAgent, runParallel, watchdogOptions, type AgentRequest } from "../execution/agent-runner.ts";
import { spawnPiProcess, type ProcessRunner, type RelayAsk } from "../execution/pi-runner.ts";
import { knowledgeFilePath, readAgentKnowledge, writeFileEnsured } from "../knowledge/store.ts";
import { taskDir } from "../knowledge/paths.ts";
import { selectKnowledge, type KnowledgeSelection } from "../knowledge/selector.ts";
import { scriptsFor } from "../scripts/pick.ts";
import { summarizeOutcomes } from "./synthesis.ts";
import { parseWorkerResult, validateWorkerResult } from "../roles/worker.ts";
import { parseReviewResult, readVerdict, validateReviewResult } from "../roles/reviewer.ts";
import { truncate } from "../text.ts";
import { isScoutResultUsable, parseScoutResult, validateScoutResult } from "../roles/scout.ts";
import { treeState } from "../execution/git.ts";
import { toolBudgetEnv, toolBudgetNote } from "../pi/tool-budget.ts";
import { recordFileNotes } from "../knowledge/file-notes.ts";
import { readCachedScout, scoutKey, writeCachedScout } from "./scout-cache.ts";
import { BOARD_ENV, BOARD_TOOLS, boardContext } from "../desk/board.ts";
import type { FileHinter } from "../classifier/files.ts";
import type { KnowledgePaths, KnowledgePicker } from "../classifier/knowledge.ts";
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
  return { model: profile.model, mcpTools: profile.mcpTools, ...(profile.skills ? { skills: profile.skills } : {}), ...(profile.autoCompact === false ? { autoCompact: false } : {}), thinking: profile.thinking };
}

function scoutInstruction(request: ScoutRequest, domain: Domain): string {
  return [
    request.instruction,
    "",
    `Domain focus: ${domainSpec(domain).scoutFocus}.`,
    "Investigate the repository and report structured findings. Do not modify any file.",
  ].join("\n");
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
async function pickKnowledge(request: { knowledge?: KnowledgePicker; dataRoots: readonly string[]; signal?: AbortSignal }, agent: Domain, query: string): Promise<KnowledgeSelection> {
  const [selected, scripts] = await Promise.all([pickFiles(request, agent, query), scriptsFor(request.dataRoots[0], query, request.knowledge?.scripts, request.signal)]);
  return scripts ? { ...selected, scripts } : selected;
}

async function pickFiles(request: { knowledge?: KnowledgePicker; dataRoots: readonly string[]; signal?: AbortSignal }, agent: Domain, query: string): Promise<KnowledgeSelection> {
  const slices = readAgentKnowledge(request.dataRoots, agent);
  if (!request.knowledge) return selectKnowledge(query, slices);
  try {
    return await request.knowledge.select(query, slices, { paths: knowledgePaths(request.dataRoots, agent), ...(request.signal ? { signal: request.signal } : {}) });
  } catch {
    return selectKnowledge(query, slices);
  }
}

function scoutContext(request: ScoutRequest, domain: Domain, selected: KnowledgeSelection, likely = ""): AgentRequest["context"] {
  return {
    task: request.taskText,
    ...selected,
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

/**
 * Run the selected domain scouts concurrently and persist their findings. A
 * domain asked the same thing before on an unchanged tree reuses its earlier
 * findings (`workflow.reuseScouts`); every new finding's Relevant Files are
 * kept as file notes for the repository map.
 */
export async function runScouts(request: ScoutRequest, run: ProcessRunner = spawnPiProcess): Promise<ScoutOutcome[]> {
  const dataDir = request.dataRoots[0];
  const tree = dataDir && request.config.workflow.reuseScouts ? await treeState(request.cwd, request.dataRoots) : undefined;
  const keys = request.domains.map((domain) => scoutKey(domain, scoutInstruction(request, domain), request.taskText));
  const cached = keys.map((key) => (dataDir && tree ? readCachedScout(dataDir, key, tree) : undefined));
  const fresh = request.domains.filter((_domain, index) => !cached[index]);
  const ran = fresh.length > 0 ? await scoutDomains({ ...request, domains: fresh }, run) : [];
  let next = 0;
  const outcomes = request.domains.map((_domain, index) => cached[index] ?? ran[next++]!);
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
  // Each scout gets the files most likely to answer its own instruction and focus.
  const [likely, selected] = await Promise.all([
    Promise.all(request.domains.map((domain) => likelyFor(request.hints, `${request.instruction}\n${domainSpec(domain).scoutFocus}`, request.signal, request.taskText))),
    Promise.all(request.domains.map((domain) => pickKnowledge(request, domain, `${request.instruction}\n${domainSpec(domain).scoutFocus}\n\n${request.taskText}`))),
  ]);
  const extraTools = request.hints?.tools() ?? [];
  const requests: AgentRequest[] = request.domains.map((domain, index) => ({
    delegationQuota: { used: 0 },
    effort: request.effort,
    taskId: request.taskId,
    domain,
    role: "scout",
    instruction: scoutInstruction(request, domain),
    context: scoutContext(request, domain, selected[index]!, likely[index]),
    ...(extraTools.length > 0 ? { extraTools } : {}),
    env: toolBudgetEnv(request.config.scout.maxToolCalls),
    ...profileFields(request.config, request.profile, domain, "scout"),
    cwd: request.cwd,
    signal: request.signal,
    onUpdate: request.onUpdate,
    ...watchdogOptions(request.config.workflow),
  }));
  // Scouts think at a fixed level; a trivial one may move to the cheaper model.
  const routes = await Promise.all(requests.map((entry) => routeFor(request.effort, entry.instruction, { ...(entry.model ? { model: entry.model } : {}), thinking: entry.thinking ?? "low" }, { thinkingFixed: true, context: request.taskText, ...(request.signal ? { signal: request.signal } : {}) })));
  const first = requests.map((entry, index) => (routes[index] ? { ...entry, ...routedFields(routes[index]!) } : entry));
  const runs = await runParallel(first, request.config.workflow.maxParallelScouts, run);
  let outcomes = runs.map((agentRun) => toOutcome(agentRun, agentRun.domain));
  // A routed scout that came back unusable runs again on its configured model.
  const again = outcomes.map((outcome, index) => (routes[index] && !outcome.usable && outcome.run.status !== "cancelled" && !request.signal?.aborted ? index : -1)).filter((index) => index >= 0);
  if (again.length > 0) {
    const reruns = await runParallel(again.map((index) => requests[index]!), request.config.workflow.maxParallelScouts, run);
    outcomes = outcomes.map((outcome, index) => {
      const position = again.indexOf(index);
      return position >= 0 ? toOutcome(reruns[position]!, reruns[position]!.domain) : outcome;
    });
  }
  return outcomes;
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

export interface WorkerOutcome {
  result: WorkerResult;
  run: AgentRun;
  issues: string[];
}

export interface WorkerRequest {
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
  /** Domains working at the same time as this one, in a parallel batch. */
  alongside?: readonly Domain[];
  /** The worker has a worktree of its own for the batch; its change is applied back when the batch ends. */
  ownCheckout?: boolean;
  /** The model ask_expert consults on. */
  expert?: { model?: string; thinking: string };
}

/** How a worker uses the task board, and what it already says for its role. */
function boardGuidance(request: WorkerRequest): string {
  if (!request.board) return "";
  return [
    "Task board: post with `post_board` whenever you settle something another agent builds against or must follow (`contract`: a route, payload, type, event or file location; `decision`), when you are blocked on someone else's part (`blocker`), and when a piece is finished and testable (`done`). Exact facts in a line or two; no progress chatter. `read_board` shows what the others posted.",
    boardContext(request.board, request.domain),
  ].filter(Boolean).join("\n\n");
}

/** What a worker in a parallel batch is told about the others, and QA about testing alongside the build. */
function alongsideGuidance(request: WorkerRequest): string {
  const others = (request.alongside ?? []).filter((domain) => domain !== request.domain);
  if (others.length === 0) return "";
  const names = others.map((domain) => ({ backend: "DEV", designer: "DESIGN", qa: "QA" })[domain]).join(" and ");
  const peers = `You work at the same time as ${names}. When you need a fact about their part (a name, a shape, a route), ask them with \`ask_peer\` instead of guessing; answer their questions with \`answer_peer\`. Questions only: neither of you takes work from the other.`;
  const checkout = request.ownCheckout
    ? " You work in a checkout of your own (no file claims needed): edit only the files your brief names, because when the batch ends your change is applied onto the others', and overlapping lines will not apply."
    : "";
  if (request.domain !== "qa") return `${peers}${checkout}`;
  return [
    `${peers}${checkout}`,
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

function workerWorkflowContext(request: WorkerRequest, likely = ""): string {
  const spec = domainSpec(request.domain);
  const own = request.scoutOutcomes.filter(
    (outcome) => outcome.result.domain === request.domain && outcome.usable,
  );
  return [
    `Task state: implementing. Domain: ${request.domain}.`,
    `Domain boundary: ${spec.boundary}`,
    "Dependency policy: never add a dependency or make a significant architectural change yourself; list them under the matching output section and stop that part of the work.",
    own.length > 0
      ? `Scout findings for your domain:\n${summarizeOutcomes(own, 1500)}`
      : "No scout findings were collected for your domain; verify the repository yourself.",
    likely,
    request.risk ?? "",
    alongsideGuidance(request),
    boardGuidance(request),
    request.ask ? askGuidance(request.ask.previews) : "",
    request.dataRoots[0] ? `Scripts you draft for the shared library go in \`${join(taskDir(request.dataRoots[0], request.taskId), "scripts")}\`.` : "",
    request.dataRoots[0] ? `Long findings (an investigation, a list of call sites, a log excerpt) go in a file under \`${join(taskDir(request.dataRoots[0], request.taskId), "notes")}\`: give its path under Notes instead of pasting them into your report, so whoever needs them reads them whole.` : "",
  ].filter(Boolean).join("\n\n");
}

/** Delegate one implementation step to a domain worker. */
export async function runWorker(
  request: WorkerRequest,
  run: ProcessRunner = spawnPiProcess,
): Promise<WorkerOutcome> {
  const configured = profileFields(request.config, request.profile, request.domain, "worker");
  const [selected, likely, route] = await Promise.all([
    pickKnowledge(request, request.domain, `${request.instruction}\n\n${request.taskText}`),
    likelyFor(request.hints, request.instruction, request.signal, request.taskText),
    routeFor(request.effort, request.instruction, { ...(configured.model ? { model: configured.model } : {}), thinking: configured.thinking }, { context: request.taskText, ...(request.signal ? { signal: request.signal } : {}) }),
  ]);
  const hintTools = request.hints?.tools() ?? [];
  const extraTools = [...(request.agent?.extraTools ?? []), ...hintTools, ...(request.board ? BOARD_TOOLS : [])];
  const env = request.board ? { ...request.agent?.env, [BOARD_ENV]: request.board, BOT_LOBBY_BOARD_FROM: request.domain } : request.agent?.env;
  const base: AgentRequest = {
    delegationQuota: { used: 0 },
    ...(request.expert ? { expert: request.expert } : {}),
    effort: request.effort,
    effortProfile: configured,
    taskId: request.taskId,
    domain: request.domain,
    role: "worker",
    instruction: request.instruction,
    context: {
      task: request.taskText,
      ...selected,
      instructions: request.config.agents[request.domain].instructions,
      workflowContext: workerWorkflowContext(request, likely),
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
  let outcome = workerOutcome(request.domain, await runAgent(route ? { ...base, ...routedFields(route) } : base, run));
  // A routed step that fell short runs again at the configured model and thinking.
  if (route && fellShort(outcome.run, outcome.issues) && !request.signal?.aborted) {
    const routed = outcome.run.edited ?? [];
    outcome = workerOutcome(request.domain, await runAgent(base, run));
    // The step owns what the routed attempt edited too.
    const edited = [...new Set([...routed, ...(outcome.run.edited ?? [])])];
    if (edited.length > 0) outcome = { ...outcome, run: { ...outcome.run, edited } };
  }
  return outcome;
}

function workerOutcome(domain: Domain, agentRun: AgentRun): WorkerOutcome {
  const result = parseWorkerResult(domain, agentRun.output);
  const issues =
    agentRun.status === "success"
      ? validateWorkerResult(result)
      : [`worker ${agentRun.status}: ${agentRun.error ?? "no detail"}`];
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
  /** Who changed each changed file (planned, quick fix, pre-existing, …), one line each. */
  provenance?: string;
  /** What the previous QA round asked for, when there was one: this round verifies it. */
  previousRound?: string;
  /** The engine's lint result on the touched files and the suppressions the task added. */
  lint?: string;
  /** Jev's QA risk read of the change: the gate's depth, test budget and focus. */
  risk?: string;
  /** The task board's contracts, decisions, blockers and finished pieces, as posted by the task's agents. */
  board?: string;
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

function reviewerAgentRequest(request: ReviewerRequest, selected: KnowledgeSelection): AgentRequest {
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
  const selected = await pickKnowledge(request, request.domain, `${request.taskText} ${request.workerSummary}`);
  const agentRequest = reviewerAgentRequest(request, selected);
  const attempts = Math.max(1, request.config.workflow.maxAgentRetries + 1);
  let agentRun = await runAgent(agentRequest, run);
  for (let attempt = 2; attempt <= attempts && isRetryableReviewRun(agentRun); attempt++) {
    agentRun = await runAgent(agentRequest, run);
  }
  const result = parseReviewResult(request.domain, agentRun.output);
  return { result, run: agentRun, issues: reviewerIssues(agentRun, result) };
}
