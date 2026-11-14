import type { ClaimedTask, ReviewVerdict } from "@aloe/core/contracts";

export interface CodeResult {
  /** Unified diff against the task's repo. */
  patch: string;
  summary: string;
  /** Pinned for reproducibility: which model and harness produced this patch. */
  model: string;
  harness: string;
}

export interface VerifyResult {
  testsPassed: boolean;
  hiddenTestsPassed: boolean;
  reviewVerdict: ReviewVerdict;
  notes: string;
}

/**
 * Something that can do the actual work. The loop doesn't care whether it's a
 * canned fake, Claude in a Docker sandbox, or the donor's own CLI.
 *
 * `signal` aborts when the lease is lost or the donor stops the agent.
 * Providers must stop promptly (kill child processes) and reject.
 */
export interface AgentProvider {
  name: string;
  runCodeTask(task: ClaimedTask, signal: AbortSignal): Promise<CodeResult>;
  runVerifyTask(task: ClaimedTask, signal: AbortSignal): Promise<VerifyResult>;
}

export type ProviderName = "fake" | "claude-sdk" | "local-claude";
export const PROVIDER_NAMES: readonly ProviderName[] = ["fake", "claude-sdk", "local-claude"];
