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
  output: string;
  error?: string;
  /** How many attempts were made; > 1 means the retry policy kicked in. */
  attempts: number;
  usage?: { input: number; output: number; cost: number; turns: number };
  startedAt: string;
  finishedAt?: string;
}
