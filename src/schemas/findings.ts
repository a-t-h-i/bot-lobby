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
  raw: string;
}

export interface AgentRun {
  runId: string;
  taskId: string;
  domain: Domain;
  role: Role;
  status: "running" | "success" | "failed" | "cancelled" | "timeout";
  output: string;
  error?: string;
  usage?: { input: number; output: number; cost: number; turns: number };
  startedAt: string;
  finishedAt?: string;
}
