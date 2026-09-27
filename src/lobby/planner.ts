/**
 * Task planning mode: a planning panel. The user describes an idea (or picks a
 * GitHub issue) and every seat questions them from its own domain — DEV,
 * DESIGN, QA and RESEARCH, each on the model and thinking level its settings
 * name — while the oracle chairs: it reads the seats' questions and notes,
 * folds every answer into the draft plan and asks what no single domain owns.
 * The user answers everyone in one conversation, so every agent that later
 * works on the task starts from the same decisions.
 *
 * Each round runs the seats in parallel (read-only; RESEARCH may also use the
 * web tools), then the oracle over their output. Rounds replay the whole
 * conversation, so one can be stopped or retried without losing the session.
 * A round limit bounds the grilling: the last round skips the seats and the
 * oracle decides whatever is still open, and later replies only revise.
 * The agreed plan is saved as a pending task.
 */
import { loadPrompt } from "../prompts/loader.ts";
import { compilePrompt } from "../prompts/compiler.ts";
import { runPiAgent, spawnPiProcess, type PiStreamEvent, type ProcessRunner } from "../execution/pi-runner.ts";
import { describeToolCall } from "../pi/activity.ts";
import { appendMetrics, type MetricRecord } from "../state/metrics.ts";
import { savePlannedTask, type IssueRef, type PlannedTask } from "../state/backlog.ts";
import { PANEL_MEMBERS, type PanelMember } from "../schemas/configuration.ts";
import { truncate } from "../text.ts";
import type { LobbyFeed } from "./feed.ts";
import type { QuickFixProfile } from "./quickfix.ts";
import { MAX_QUESTIONS, type AskResult } from "./ask.ts";

/** Seats and the oracle read the repository to ask informed questions; they never edit. */
export const PLANNER_TOOLS: readonly string[] = ["read", "grep", "find", "ls"];
/** RESEARCH also gets the web tools (from pi-web-access; pi ignores them when it is not installed). */
export const RESEARCH_PANEL_TOOLS: readonly string[] = [...PLANNER_TOOLS, "web_search", "fetch_content", "source_check", "get_search_content"];

/** The chair of the panel, as the Plan tab, the feed and the metrics name it. */
export const ORACLE_LABEL = "ORACLE";

export const MEMBER_LABELS: Record<PanelMember, string> = { backend: "DEV", designer: "DESIGN", qa: "QA", researcher: "RESEARCH" };

/** What each seat owns; appended to the seat's system prompt. */
const MEMBER_SEATS: Record<PanelMember, string> = {
  backend: "You are DEV: the backend and the code — APIs and contracts, data and migrations, errors and edge cases, security and permissions, performance, dependencies, and how the change fits the existing architecture.",
  designer: "You are DESIGN: the user's experience and the frontend — flows, screens and components, empty/loading/error states, copy, the visual language, responsive behavior and accessibility.",
  qa: "You are QA: how the work will be judged — acceptance criteria, the test strategy and where tests live, edge cases and failure modes, environments and browsers, regression risk and the definition of done.",
  researcher: "You are RESEARCH: facts outside the repository — libraries and versions, standards, APIs and documentation, known pitfalls and prior art. Use the web tools when you have them and cite a URL for every external claim; ask the user to choose where the options you found really differ.",
};

/** One answer the asker offers: a short label and what choosing it means. */
export interface PanelOption {
  label: string;
  description: string;
}

/** A question as a seat or the oracle wrote it, with the options it offers (recommended first). */
export interface AskedQuestion {
  text: string;
  options: PanelOption[];
}

export interface PanelQuestion extends AskedQuestion {
  /** DEV, DESIGN, QA, RESEARCH or ORACLE. */
  from: string;
}

export interface PlannerMessage {
  role: "you" | "planner";
  text: string;
  at: number;
  /** The round's questions, attributed, when the panel asked any. */
  questions?: PanelQuestion[];
}

/** The oracle's reply: its verdict, title, own questions and the draft plan. */
export interface PlannerReply {
  status: "grilling" | "ready";
  title?: string;
  questions: AskedQuestion[];
  plan?: string;
}

/** A seat's reply: whether its domain is settled, its questions and what the plan must respect. */
export interface MemberReply {
  status: "open" | "ready";
  questions: AskedQuestion[];
  notes: string[];
}

export interface MemberState {
  member: PanelMember;
  status: "thinking" | "done" | "failed";
  step?: string;
  reply?: MemberReply;
  error?: string;
}

export interface PanelNote {
  from: string;
  text: string;
}

/** An issue the session was seeded from, with its text. */
export interface PlannerSeed {
  issue: IssueRef;
  body: string;
}

export interface PlannerDeps {
  cwd: string;
  root: string;
  configDir: string;
  /** The oracle chairing the panel (the Planner settings entry). */
  profile: () => QuickFixProfile;
  /** A seat's model, thinking and time limit; the oracle's profile when absent. */
  memberProfile?: (member: PanelMember) => QuickFixProfile;
  /** Seats on the panel when the session starts; every seat when absent. */
  panel?: readonly PanelMember[];
  stallTimeoutMs?: number;
  toolStallTimeoutMs?: number;
  feed?: LobbyFeed;
  runProcess?: ProcessRunner;
  onChange?: () => void;
  /** Called when a round ends (answered, failed or stopped), so the lobby can put the questions to the user. */
  onRound?: (session: PlanningSession) => void;
  /** Rounds before the oracle finalizes alone (0 or absent = unlimited); read as each round starts. */
  maxRounds?: () => number;
}

/**
 * How a round runs under the limit: `normal` grilling with the seats, the
 * `final` round (the oracle alone, deciding what is open), or `revise` once
 * past the limit (the oracle alone, revising for the user's latest message).
 */
export type RoundMode = "normal" | "final" | "revise";

export function roundMode(round: number, limit: number): RoundMode {
  if (limit <= 0 || round < limit) return "normal";
  return round === limit ? "final" : "revise";
}

/** What the oracle is told to do at the end of its task, by round mode. */
export function oracleClosing(mode: RoundMode, round: number, limit: number): string {
  if (mode === "final") {
    return `Final round (${round} of ${limit}): no seat runs this round and nothing more is asked. Fold the user's answers into the plan, decide every point still open with its recommended option and list each under ### Assumptions, and set Status READY. Omit the Questions section. Reply in the required output format.`;
  }
  if (mode === "revise") {
    return `The planning round limit (${limit}) is reached: revise the plan for the user's latest message and comments. Ask nothing; decide anything open with its recommended option under ### Assumptions, and keep Status READY. Omit the Questions section. Reply in the required output format.`;
  }
  const bound = limit > 0 ? `Round ${round} of ${limit}; in round ${limit} you settle whatever is still open alone, so ask the decisive questions now. ` : "";
  return `${bound}Continue: fold the panel's notes and the user's answers into the plan, ask what no seat owns, or declare the plan READY. Reply in the required output format.`;
}

/** `round 2 of 5`, for a seat's task; empty without a limit. */
function roundNote(round: number, limit: number): string {
  return limit > 0 ? ` (round ${round} of ${limit})` : "";
}

/** Split a reply into its top-level `## Section` bodies, keyed by lower-case title. */
function sections(text: string): Map<string, string> {
  const found = new Map<string, string>();
  let current: string | undefined;
  let body: string[] = [];
  const flush = () => {
    if (current && !found.has(current)) found.set(current, body.join("\n").trim());
  };
  for (const line of text.split("\n")) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      flush();
      current = match[1]!.toLowerCase();
      body = [];
    } else if (current) body.push(line);
  }
  flush();
  return found;
}

function listItems(body: string | undefined): string[] {
  if (!body) return [];
  const items: string[] = [];
  for (const line of body.split("\n")) {
    const match = /^\s*(?:\d+[.)]|[-*])\s+(.*\S)\s*$/.exec(line);
    if (match) items.push(match[1]!);
    else if (line.trim() && items.length > 0 && /^\s+/.test(line)) items[items.length - 1] += ` ${line.trim()}`;
  }
  return items;
}

/** `Label — what it means` (or `Label: …`, `Label - …`); bold markers dropped. */
export function parseOption(text: string): PanelOption {
  const flat = text.replace(/\*\*/g, "").trim();
  const split = /^(.*?)\s+(?:—|–|-)\s+(.+)$/.exec(flat) ?? /^([^:]{1,60}):\s+(.+)$/.exec(flat);
  return split ? { label: split[1]!.trim(), description: split[2]!.trim() } : { label: flat, description: "" };
}

/** The option the asker recommends: the one marked `(Recommended)`, else the first. */
export function recommendedOption(question: AskedQuestion): PanelOption | undefined {
  return question.options.find((option) => /\(recommended\)/i.test(option.label)) ?? question.options[0];
}

/** An option's label without its `(Recommended)` marker. */
export function optionLabel(option: PanelOption): string {
  return option.label.replace(/\s*\(recommended\)\s*/i, " ").trim();
}

/**
 * Record questions nobody will ask any more as assumptions in the plan, each
 * decided with its recommended option: under the plan's `### Assumptions`
 * section when it has one, otherwise in a new one at the end.
 */
export function appendAssumptions(plan: string, questions: readonly PanelQuestion[], why: string): string {
  if (questions.length === 0) return plan;
  const lines = questions.map((question) => {
    const pick = recommendedOption(question);
    return `- [${question.from}] ${question.text} → ${pick ? optionLabel(pick) : "the oracle's call"} (${why})`;
  });
  const rows = plan.split("\n");
  const heading = rows.findIndex((row) => /^#{2,3}\s+assumptions\s*$/i.test(row.trim()));
  if (heading < 0) return `${plan.trimEnd()}\n\n### Assumptions\n${lines.join("\n")}`;
  let end = rows.findIndex((row, index) => index > heading && /^#{1,3}\s/.test(row));
  if (end < 0) end = rows.length;
  while (end > heading + 1 && rows[end - 1]!.trim() === "") end -= 1;
  return [...rows.slice(0, end), ...lines, ...rows.slice(end)].join("\n");
}

/** Inline `a) … b) …` choices, when a question carries its options in its own text. */
function inlineOptions(question: AskedQuestion): AskedQuestion {
  if (question.options.length > 0) return question;
  const parts = question.text.split(/\s(?=[a-d]\)\s)/);
  if (parts.length < 3) return question;
  const options = parts.slice(1).map((part) => parseOption(part.replace(/^[a-d]\)\s+/, "").replace(/[;,.]\s*$/, "")));
  return { text: parts[0]!.trim(), options };
}

/**
 * Numbered or bulleted questions, each with the options indented beneath it
 * (`   - Users table (Recommended) — follows the user`); continuation lines
 * join the question or the option they follow.
 */
export function questionItems(body: string | undefined): AskedQuestion[] {
  if (!body) return [];
  const items: AskedQuestion[] = [];
  let current: AskedQuestion | undefined;
  for (const line of body.split("\n")) {
    const match = /^(\s*)(?:\d+[.)]|[-*])\s+(.*\S)\s*$/.exec(line);
    if (match && (match[1]!.length === 0 || !current)) {
      current = { text: match[2]!.replace(/\*\*/g, ""), options: [] };
      items.push(current);
    } else if (match && current) {
      current.options.push(parseOption(match[2]!));
    } else if (line.trim() && current) {
      const last = current.options.at(-1);
      if (last) last.description = `${last.description} ${line.trim()}`.trim();
      else current.text = `${current.text} ${line.trim()}`;
    }
  }
  return items.map(inlineOptions);
}

/**
 * The round's questions for the user. The oracle chooses them from its own
 * and the seats' (tagged with the seat each serves) and decides the rest; only
 * when its part failed do the seats' own questions go through. Never more than
 * `MAX_QUESTIONS`, so a round is answered in one questionnaire.
 */
export function roundQuestions(reply: PlannerReply | undefined, seatQuestions: readonly PanelQuestion[]): PanelQuestion[] {
  const chosen = reply ? reply.questions.map((question) => tagged(question, ORACLE_LABEL)) : [...seatQuestions];
  return chosen.slice(0, MAX_QUESTIONS);
}

/** A leading `[SEAT]` tag names who asked; the oracle uses it when it relays a seat. */
function tagged(question: AskedQuestion, fallback: string): PanelQuestion {
  const tag = /^\[(DEV|DESIGN|QA|RESEARCH|ORACLE)\]\s*/i.exec(question.text);
  return tag ? { ...question, from: tag[1]!.toUpperCase(), text: question.text.slice(tag[0].length) } : { ...question, from: fallback };
}

/**
 * Read the oracle's reply. Missing sections degrade gracefully: no status
 * reads as grilling, and a reply with no sections at all becomes one question
 * so the user always sees what was said.
 */
export function parsePlannerReply(text: string): PlannerReply {
  const parts = sections(text);
  const status = /\bready\b/i.test(parts.get("status") ?? "") ? "ready" : "grilling";
  const title = parts.get("title")?.split("\n").find((line) => line.trim())?.replace(/^[#*\s]+|[*\s]+$/g, "");
  const plan = parts.get("plan") ?? parts.get("draft plan");
  let questions = questionItems(parts.get("questions"));
  if (parts.size === 0 && text.trim()) questions = [{ text: text.trim(), options: [] }];
  return { status, questions, ...(title ? { title } : {}), ...(plan ? { plan } : {}) };
}

/** Read a seat's reply the same forgiving way: a READY seat asks nothing. */
export function parseMemberReply(text: string): MemberReply {
  const parts = sections(text);
  const ready = /\bready\b/i.test(parts.get("status") ?? "");
  let questions = ready ? [] : questionItems(parts.get("questions"));
  if (parts.size === 0 && text.trim()) questions = [{ text: text.trim(), options: [] }];
  return { status: ready ? "ready" : "open", questions, notes: listItems(parts.get("notes")) };
}

function optionLines(options: readonly PanelOption[]): string[] {
  return options.map((option) => `   - ${option.label}${option.description ? ` — ${option.description}` : ""}`);
}

function questionLine(question: PanelQuestion, index: number): string {
  return [`${index + 1}. [${question.from}] ${question.text}`, ...optionLines(question.options)].join("\n");
}

/** The conversation, the source issue and the current draft: what every seat and the oracle read. */
export function plannerTranscript(messages: readonly PlannerMessage[], seed?: PlannerSeed, draft?: string, closing = "Continue: grill the user on what is still open, or declare the plan READY. Reply in the required output format."): string {
  const lines: string[] = [];
  if (seed) {
    lines.push(`## Source: GitHub issue #${seed.issue.number} — ${seed.issue.title}`, "", truncate(seed.body.trim() || "(no description)", 6000), "");
  }
  lines.push("## Conversation so far (oldest first)", "");
  for (const message of messages) {
    const body = message.questions && message.questions.length > 0 ? message.questions.map(questionLine).join("\n") : message.text.trim();
    lines.push(message.role === "you" ? "### User" : "### Panel", "", body, "");
  }
  if (draft) lines.push("## The oracle's current draft plan", "", truncate(draft, 8000), "");
  lines.push(closing);
  return lines.join("\n");
}

export interface MemberOutcome {
  member: PanelMember;
  reply?: MemberReply;
  error?: string;
}

/** The seats' output for the oracle: each seat's status, questions and notes, or its failure. */
export function panelSection(outcomes: readonly MemberOutcome[]): string {
  if (outcomes.length === 0) return "## Panel this round\n\nNo domain seats this round; you are planning alone.";
  const blocks = outcomes.map((outcome) => {
    const label = MEMBER_LABELS[outcome.member];
    if (!outcome.reply) return `### ${label} — no answer this round (${outcome.error ?? "failed"})`;
    const { status, questions, notes } = outcome.reply;
    return [
      `### ${label} — ${status === "ready" ? "READY" : "OPEN"}`,
      questions.length > 0 ? `Questions for the user:\n${questions.map((question) => [`- ${question.text}`, ...optionLines(question.options)].join("\n")).join("\n")}` : "",
      notes.length > 0 ? `Notes:\n${notes.map((note) => `- ${note}`).join("\n")}` : "",
    ].filter(Boolean).join("\n");
  });
  return ["## Panel this round", "", ...blocks].join("\n\n");
}

/** A comment the user left on one line of the draft plan. */
export interface LineComment {
  /** The line as shown, without styling. */
  line: string;
  text: string;
}

/** Line comments as part of the user's next turn. */
export function commentBlock(comments: readonly LineComment[]): string {
  if (comments.length === 0) return "";
  return ["Comments on the draft plan:", ...comments.map((comment) => `- On "${comment.line.replace(/\s+/g, " ").trim()}": ${comment.text.trim()}`)].join("\n");
}

/** What the panel said in a round, as the conversation shows it. */
export function plannerSays(ready: boolean, questions: readonly PanelQuestion[], mode: RoundMode = "normal"): string {
  if (mode !== "normal") {
    return ready
      ? "The round limit is reached: the oracle decided what was still open (see Assumptions). Save the plan, or comment on a line to revise it."
      : "The round limit is reached, but there is no draft yet. Reply or retry to let the oracle write one.";
  }
  if (ready) return "The panel agrees the plan is clear. Save it as a pending task, or keep refining.";
  if (questions.length === 0) return "No open questions this round. Save the draft, or add detail.";
  return questions.map(questionLine).join("\n");
}

export function plannerPrompt(instructions?: string): string {
  const custom = instructions?.trim();
  return custom ? `${loadPrompt("planner.md")}\n\n## Custom Instructions\n\n${custom}` : loadPrompt("planner.md");
}

/** A seat's system prompt: its domain's layers (or the global one for RESEARCH), the panel role and its seat. */
export function memberPrompt(member: PanelMember, instructions?: string): string {
  const base = member === "researcher"
    ? [loadPrompt("global.md"), instructions?.trim() ? `## Custom Instructions\n\n${instructions.trim()}` : ""].filter(Boolean).join("\n\n---\n\n")
    : compilePrompt({ domain: member, task: "", instructions });
  return [base, loadPrompt("panel.md"), `## Your seat\n\n${MEMBER_SEATS[member]}`].join("\n\n---\n\n");
}

interface RunOutcome {
  status: MetricRecord["status"];
  output: string;
  error?: string;
  model?: string;
  usage: { input: number; output: number; cost: number; turns: number };
}

export class PlanningSession {
  messages: PlannerMessage[] = [];
  seed?: PlannerSeed;
  /** The oracle's latest reply; its plan is the current draft. */
  reply?: PlannerReply;
  /** The latest round's questions, attributed; empty once the panel agrees. */
  questions: PanelQuestion[] = [];
  /** What each seat said the plan must respect, from its latest answer. */
  notes: PanelNote[] = [];
  /** This round's seats (or the last round's once it finished). */
  members: MemberState[] = [];
  /** Seats that sit on the panel next round. */
  readonly seats: Set<PanelMember>;
  status: "idle" | "thinking" = "idle";
  /** What the oracle is doing during its part of the round. */
  step?: string;
  error?: string;
  turns = 0;
  saved?: PlannedTask;
  /** Questionnaires answered so far for this round's questions, so stopping one resumes where it left off. */
  answered: AskResult[] = [];
  /** Comments on draft lines, sent with the user's next turn. */
  lineComments: LineComment[] = [];
  /** How the latest round ran under the round limit. */
  mode: RoundMode = "normal";
  private controller?: AbortController;
  /** Round attempts, retries included, so each attempt's feed steps stay apart. */
  private attempts = 0;
  private readonly deps: PlannerDeps;
  private readonly memberNotes = new Map<PanelMember, string[]>();

  constructor(deps: PlannerDeps, seed?: PlannerSeed) {
    this.deps = deps;
    this.seats = new Set(deps.panel ?? PANEL_MEMBERS);
    if (seed) this.seed = seed;
  }

  get title(): string | undefined {
    return this.reply?.title ?? this.seed?.issue.title;
  }

  get busy(): boolean {
    return this.status === "thinking";
  }

  /** Rounds before the oracle finalizes alone; 0 = unlimited. */
  get limit(): number {
    return Math.max(0, this.deps.maxRounds?.() ?? 0);
  }

  /** How the next round will run. */
  get nextMode(): RoundMode {
    return roundMode(this.turns + 1, this.limit);
  }

  /** Seat or unseat a member for the next round; returns whether it now sits. */
  toggle(member: PanelMember): boolean {
    if (this.seats.has(member)) this.seats.delete(member);
    else this.seats.add(member);
    this.deps.onChange?.();
    return this.seats.has(member);
  }

  /** Add the user's message (the idea, or answers), with any line comments, and run a round. */
  async send(text: string): Promise<void> {
    const body = [text.trim(), commentBlock(this.lineComments)].filter(Boolean).join("\n\n");
    if (!body) return;
    if (this.busy) throw new Error("the panel is still thinking");
    this.lineComments = [];
    this.messages = [...this.messages, { role: "you", text: body, at: Date.now() }];
    await this.turn();
  }

  /** The round's questions still wait for answers. */
  get awaitingAnswers(): boolean {
    return !this.busy && this.questions.length > 0;
  }

  /**
   * Comment on one line of the draft. While questions wait for answers the
   * comment rides along with them; otherwise it goes to the panel now.
   * Returns whether a round started.
   */
  commentOnLine(line: string, text: string): boolean {
    const body = text.trim();
    if (!body || !line.trim()) return false;
    this.lineComments = [...this.lineComments, { line: line.trim(), text: body }];
    this.deps.onChange?.();
    if (this.busy || this.awaitingAnswers) return false;
    void this.send("");
    return true;
  }

  /** Start from the seed alone (an issue) without a user message. */
  async open(): Promise<void> {
    if (this.busy || this.messages.length > 0) return;
    await this.turn();
  }

  /** Whether `retry` has something to do: the last round failed, was stopped, or lost a seat. */
  get retryable(): boolean {
    if (this.busy) return false;
    const last = this.messages.at(-1);
    if (last?.role === "you") return true;
    return last?.role === "planner" && (Boolean(this.error) || this.members.some((member) => member.status === "failed"));
  }

  /** Run the last round again, without a new message (replacing its questions when it had any). */
  async retry(): Promise<void> {
    if (!this.retryable) return;
    if (this.messages.at(-1)?.role === "planner") this.messages = this.messages.slice(0, -1);
    // A retry replays the same round; it does not use up another one.
    this.turns = Math.max(0, this.turns - 1);
    await this.turn();
  }

  cancel(): void {
    this.controller?.abort();
  }

  /** Save the latest draft as a pending task. */
  save(now = new Date()): PlannedTask {
    const plan = this.reply?.plan;
    if (!plan) throw new Error("there is no draft plan to save yet");
    this.saved = savePlannedTask(this.deps.root, this.deps.configDir, {
      title: this.title ?? this.messages[0]?.text.split("\n")[0] ?? "planned task",
      brief: plan,
      ...(this.seed ? { issue: this.seed.issue } : {}),
    }, now);
    this.deps.feed?.log(ORACLE_LABEL, `saved ${this.saved.id} to pending tasks`, "success");
    this.deps.onChange?.();
    return this.saved;
  }

  private stepKey(who: string): string {
    return `plan-${who}-${this.attempts}`;
  }

  /** Stream one agent's steps and thoughts into its state and the lobby feed. */
  private onEvent(label: string, event: PiStreamEvent, setStep: (step: string) => void): void {
    if (event.type === "tool_execution_start") {
      const step = describeToolCall(event.toolName, event.args);
      setStep(step);
      this.deps.feed?.step(label, step, this.stepKey(label));
    } else if (event.type === "thought") this.deps.feed?.thought(label, event.text);
    else if (event.type === "thinking" || event.type === "writing") setStep(event.type);
    else return;
    this.deps.onChange?.();
  }

  private async run(label: string, kind: "planner" | "panel", profile: QuickFixProfile, request: { task: string; systemPrompt: string; tools: readonly string[] }, signal: AbortSignal, setStep: (step: string) => void): Promise<RunOutcome> {
    const startedAt = Date.now();
    let outcome: RunOutcome;
    try {
      const result = await runPiAgent(
        {
          cwd: this.deps.cwd,
          ...request,
          model: profile.model,
          thinking: profile.thinking,
          timeoutMs: profile.timeoutMs,
          signal,
          stallTimeoutMs: this.deps.stallTimeoutMs,
          toolStallTimeoutMs: this.deps.toolStallTimeoutMs,
          onEvent: (event) => this.onEvent(label, event, setStep),
        },
        this.deps.runProcess ?? spawnPiProcess,
      );
      outcome = { status: result.status, output: result.output, ...(result.error ? { error: result.error } : {}), ...(result.model ? { model: result.model } : {}), usage: result.usage };
    } catch (error) {
      outcome = { status: "failed", output: "", error: (error as Error).message, usage: { input: 0, output: 0, cost: 0, turns: 0 } };
    }
    this.deps.feed?.end(this.stepKey(label), outcome.status !== "success");
    appendMetrics(this.deps.root, this.deps.configDir, [planningMetric(kind, label, this.turns, startedAt, outcome.status, profile, outcome.model, outcome.usage)]);
    return outcome;
  }

  private async runMember(state: MemberState, transcript: string, signal: AbortSignal): Promise<MemberOutcome> {
    const member = state.member;
    const label = MEMBER_LABELS[member];
    const profile = this.deps.memberProfile?.(member) ?? this.deps.profile();
    const outcome = await this.run(label, "panel", profile, {
      task: `${transcript}\n\nYou are ${label} on the planning panel${roundNote(this.turns, this.limit)}: ask your seat's open questions, or declare READY.`,
      systemPrompt: memberPrompt(member, profile.instructions),
      tools: member === "researcher" ? RESEARCH_PANEL_TOOLS : PLANNER_TOOLS,
    }, signal, (step) => (state.step = step));
    if (outcome.status === "success") {
      state.reply = parseMemberReply(outcome.output);
      state.status = "done";
      this.memberNotes.set(member, state.reply.notes);
    } else {
      state.status = "failed";
      state.error = outcome.error ?? outcome.status;
      this.deps.feed?.log(label, `planning round failed — ${state.error.split("\n")[0]}`, "error");
    }
    state.step = undefined;
    this.deps.onChange?.();
    return { member, ...(state.reply ? { reply: state.reply } : {}), ...(state.error ? { error: state.error } : {}) };
  }

  private async turn(): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    this.status = "thinking";
    this.error = undefined;
    this.turns += 1;
    this.attempts += 1;
    this.answered = [];
    const limit = this.limit;
    const mode = roundMode(this.turns, limit);
    this.mode = mode;
    // At and past the limit the oracle works alone: the seats have had their rounds.
    const seated = mode === "normal" ? PANEL_MEMBERS.filter((member) => this.seats.has(member)) : [];
    this.members = seated.map((member) => ({ member, status: "thinking", step: "reading the conversation" }));
    this.step = this.members.length > 0 ? "waiting for the panel" : "reading the conversation";
    this.deps.onChange?.();
    try {
      const transcript = plannerTranscript(this.messages, this.seed, this.reply?.plan, "");
      const outcomes = await Promise.all(this.members.map((state) => this.runMember(state, transcript, controller.signal)));
      if (controller.signal.aborted) throw new Error("stopped");
      this.notes = PANEL_MEMBERS.flatMap((member) => (this.memberNotes.get(member) ?? []).map((text) => ({ from: MEMBER_LABELS[member], text })));
      this.step = "writing the plan";
      this.deps.onChange?.();
      const profile = this.deps.profile();
      const lead = await this.run(ORACLE_LABEL, "planner", profile, {
        task: `${plannerTranscript(this.messages, this.seed, this.reply?.plan, "")}\n\n${panelSection(outcomes)}\n\n${oracleClosing(mode, this.turns, limit)}`,
        systemPrompt: plannerPrompt(profile.instructions),
        tools: PLANNER_TOOLS,
      }, controller.signal, (step) => (this.step = step));
      if (controller.signal.aborted) throw new Error("stopped");
      this.finishRound(outcomes, lead, mode);
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.status = "idle";
      this.step = undefined;
      this.controller = undefined;
      if (this.error) this.deps.feed?.log(ORACLE_LABEL, `planning round failed — ${this.error.split("\n")[0]}`, "error");
      this.deps.onChange?.();
      this.deps.onRound?.(this);
    }
    // Comments left on draft lines during the round go to the panel now, unless questions wait (they ride with the answers).
    if (!this.error && !this.busy && this.questions.length === 0 && this.lineComments.length > 0) await this.send("");
  }

  /**
   * The oracle's reply sets the round's questions (chosen from the seats' and
   * its own), verdict and draft. At and past the round limit nothing more is
   * asked: any question the oracle still wrote is decided with its
   * recommended option and recorded in the plan's Assumptions, and a plan
   * that exists is READY.
   */
  private finishRound(outcomes: readonly MemberOutcome[], lead: RunOutcome, mode: RoundMode): void {
    const reply = lead.status === "success" ? parsePlannerReply(lead.output) : undefined;
    const seatQuestions = outcomes.flatMap((outcome) => (outcome.reply?.questions ?? []).map((question) => ({ ...question, from: MEMBER_LABELS[outcome.member] })));
    let questions = roundQuestions(reply, seatQuestions);
    const seatsReady = outcomes.every((outcome) => outcome.reply?.status === "ready");
    let ready = Boolean(reply && reply.status === "ready" && seatsReady);
    if (reply) {
      // A round without a plan keeps the previous draft.
      let plan = reply.plan ?? this.reply?.plan;
      if (mode !== "normal") {
        if (plan && questions.length > 0) {
          plan = appendAssumptions(plan, questions, "decided at the round limit");
          this.deps.feed?.log(ORACLE_LABEL, `round limit: decided ${questions.length} open question${questions.length === 1 ? "" : "s"} with the recommended option`, "info");
        }
        questions = [];
        ready = Boolean(plan);
      }
      this.reply = { ...reply, status: ready ? "ready" : "grilling", ...(mode !== "normal" ? { questions: [] } : {}), ...(plan ? { plan } : {}) };
    } else {
      this.error = `the oracle's part of the round failed — ${lead.error ?? lead.status}`;
    }
    if (!reply && seatQuestions.length === 0) return;
    this.questions = ready ? [] : questions;
    this.messages = [...this.messages, { role: "planner", text: plannerSays(ready, this.questions, mode), at: Date.now(), ...(this.questions.length > 0 ? { questions: this.questions } : {}) }];
  }
}

export function planningMetric(
  kind: "planner" | "panel",
  agent: string,
  turn: number,
  startedAt: number,
  status: MetricRecord["status"],
  profile: QuickFixProfile,
  model: string | undefined,
  usage: { input: number; output: number; cost: number; turns: number },
  now = Date.now(),
): MetricRecord {
  const served = model ?? profile.model;
  return {
    id: `${kind}-${agent.toLowerCase()}-${startedAt}-${turn}`,
    kind,
    agent,
    ...(served ? { model: served } : {}),
    thinking: profile.thinking,
    status,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Math.max(0, now - startedAt),
    ...(usage.turns ? { turns: usage.turns } : {}),
    input: usage.input,
    output: usage.output,
    cost: usage.cost,
  };
}
