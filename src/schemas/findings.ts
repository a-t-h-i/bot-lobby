import type { Domain, Role } from "./agent.ts";
import type { Blocker, Verdict } from "./task.ts";

export interface RelevantFile {
  path: string;
  reason: string;
}

export interface FileChange {
  path: string;
  change: string;
}

/** A subagent's reasoned objection to a change request; the oracle decides its fate. */
export interface Pushback {
  request: string;
  reason: string;
  alternative?: string;
}

export interface KnowledgeProposal {
  domain: Domain;
  kind: "knowledge" | "standard" | "decision" | "completed";
  content: string;
}

export interface ScoutResult {
  domain: Domain;
  role: "scout";
  scope: string;
  findings: string[];
  relevantFiles: RelevantFile[];
  patterns: string[];
  risks: string[];
  recommendations: string[];
  confidence: "high" | "medium" | "low";
  pushback?: Pushback;
  raw: string;
}

export interface WorkerResult {
  domain: Domain;
  role: "worker";
  completed: string;
  /** Stopped for time: what it was doing and what is still to do. */
  leftOff?: string;
  /** Stopped for time: the minutes it asks for, and why. */
  moreTime?: { minutes?: number; reason: string };
  filesChanged: FileChange[];
  verification: string;
  notes: string;
  blockers: Blocker[];
  knowledgeProposals: KnowledgeProposal[];
  dependencyNeeds: string[];
  architectureChanges: string[];
  pushback?: Pushback;
  raw: string;
}

export interface ReviewFinding {
  severity: "critical" | "major" | "minor" | "info";
  text: string;
}

export interface ReviewResult {
  domain: Domain;
  role: "reviewer";
  verdict: Verdict;
  findings: ReviewFinding[];
  verification: string;
  requiredChanges: string[];
  optionalImprovements: string[];
  pushback?: Pushback;
  /** Set when the engine downgraded an unsupported PASS. */
  downgraded?: string;
  /** Set when the engine passed a CHANGES_REQUIRED that named only minor or info findings. */
  relaxed?: string;
  raw: string;
}

export interface ResearchSource {
  url: string;
  title: string;
  /** Publication date or version the claim was checked against, when stated. */
  date?: string;
}

export interface ResearchResult {
  domain: Domain;
  role: "researcher";
  question: string;
  findings: string[];
  sources: ResearchSource[];
  recommendations: string[];
  confidence: "high" | "medium" | "low";
  unverified: string[];
  pushback?: Pushback;
  raw: string;
}

export interface AgentRun {
  runId: string;
  taskId: string;
  domain: Domain;
  role: Role;
  status: "running" | "success" | "failed" | "cancelled" | "timeout";
  /** Concrete instruction sent for this run; lets the panel map it to a plan step. */
  instruction?: string;
  /** One word for the tool action in flight (reading, editing, running, ...). */
  activity?: string;
  output: string;
  error?: string;
  /** How many attempts were made; > 1 means the retry policy kicked in. */
  attempts: number;
  usage?: { input: number; output: number; cost: number; turns: number };
  startedAt: string;
  finishedAt?: string;
  /** Short target of the activity in flight: a file, command head or pattern. */
  detail?: string;
  /** The tool call in flight in plain words (`reading users.ts`); feeds the lobby's activity log. */
  step?: string;
  /** The agent's latest finished thought, bounded; the lobby shows it in its thinking pane. */
  thought?: string;
  /** Assistant turns and tool calls so far. */
  turns?: number;
  tools?: number;
  /** Epoch ms of the last streamed output; drives the "quiet" warning. */
  lastEventAt?: number;
  /** Transient status worth surfacing: retrying, compacting, wrapping up, waiting on a file. */
  note?: string;
  noteKind?: "info" | "warning";
  /** Model that actually served the run. */
  model?: string;
  /** Thinking level the run was started with. */
  thinking?: string;
  /** Killed by the stall watchdog after going silent. */
  stalled?: boolean;
  /** Asked to wrap up before its deadline; the report may be partial. */
  wrappedUp?: boolean;
  /** File this worker is queued for at the file desk. */
  waitingFor?: string;
  /** The run switched to its fallback model because this one ran out of usage or was unavailable. */
  fellBackFrom?: string;
  /** The classifier routed this run down: the configured profile it came from (`p/big · medium`). */
  routedFrom?: string;
  /** Why and where it was routed (`trivial 0.88: p/big · medium → p/cheap · low`). */
  route?: string;
  /** Files the run changed with `edit`/`write`, absolute, across its attempts. */
  edited?: string[];
  /** Under a task time budget: the time it was given, when that runs out (epoch ms), and any granted since. */
  allotMs?: number;
  endsAt?: number;
  extendedMs?: number;
  /** Stopped at its allotted time and not given more: its report says where it left off. */
  timeUp?: boolean;
}
