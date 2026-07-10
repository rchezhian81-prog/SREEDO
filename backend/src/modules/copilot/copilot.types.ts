// PR-T11 — GoCampus AI Copilot Phase 1 (read-only assistant).
//
// The copilot NEVER mutates, sends, enqueues, schedules or approves anything.
// It answers by running an allow-list of RETRIEVERS — thin wrappers around the
// same permissioned, tenant-scoped service functions the UI already calls —
// and (optionally) letting the LLM phrase the retrieved facts. A retriever only
// runs when the CALLER's effective permissions include every key it declares,
// so the model never receives data the user couldn't already see in the UI.

import type { InstitutionType } from "../../middleware/institution-type";

/** A citation attached to the reply — every factual claim traces to one. */
export interface CopilotSource {
  type: "metric" | "doc" | "link";
  /** Stable id: metric key, tenant-help doc id (art-… / sop-… / gs-…) or href. */
  id: string;
  label: string;
  /** In-app path for the manual screen / doc the source lives on. */
  href?: string;
}

/** What one retriever returns: compact fact lines + their citations. */
export interface RetrieverResult {
  facts: string[];
  sources: CopilotSource[];
}

export interface RetrieverContext {
  institutionId: string;
  userId: string;
  /** The (raw) user message — used only for help-doc search terms. */
  message: string;
  mode: InstitutionType;
}

export interface Retriever {
  key: string;
  /** Every key must be in the caller's effective permission set. */
  perms: string[];
  /** Additionally restricted to the coarse admin role (audit trail reads). */
  adminOnly?: boolean;
  run(ctx: RetrieverContext): Promise<RetrieverResult>;
}

export interface CopilotAnswer {
  reply: string;
  sources: CopilotSource[];
  /** Which retrievers actually ran (also written to the audit event). */
  retrieversUsed: string[];
  /** False when the LLM call failed and the deterministic fallback answered. */
  aiAvailable: boolean;
  conversationId: string | null;
}
