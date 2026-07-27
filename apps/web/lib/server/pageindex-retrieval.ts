import type { PageIndexRetrievalStrategy } from "@helpdesk/shared";
import { getPageIndexRetrievalConfig } from "./env";
import { buildCompactOutline, buildPageIndexForest, expandSelectedTreeNodes } from "./pageindex-tree";
import { selectPageIndexNodes } from "./pageindex-reasoning";
import {
  getAllNodesForDocuments,
  listReadyDocuments
} from "./repository";
import {
  retrievePageIndexNodes,
  type RetrievedNode,
  type RetrievePageIndexInput
} from "./retrieval";

export interface PageIndexRetrievalDiagnostics {
  requestedStrategy: PageIndexRetrievalStrategy;
  usedStrategy: PageIndexRetrievalStrategy;
  engineVersion?: string;
  selectedNodeIds?: string[];
  fallbackReason?: string;
  latencyMs: number;
  llmCalls: number;
  candidateNodeCount?: number;
  outlineTruncated?: boolean;
  outlineChars?: number;
}

export interface PageIndexRetrievalResult {
  nodes: RetrievedNode[];
  diagnostics: PageIndexRetrievalDiagnostics;
}

export interface DispatchPageIndexInput extends RetrievePageIndexInput {
  strategy?: PageIndexRetrievalStrategy;
  model?: string;
  allowExperimental?: boolean;
}

export async function retrievePageIndex(
  input: DispatchPageIndexInput
): Promise<PageIndexRetrievalResult> {
  const config = getPageIndexRetrievalConfig();
  const requestedStrategy = input.strategy ?? config.strategy;
  const startedAt = performance.now();

  if (requestedStrategy === "lexical") {
    const nodes = await retrievePageIndexNodes(input);
    return {
      nodes,
      diagnostics: {
        requestedStrategy,
        usedStrategy: "lexical",
        latencyMs: round(performance.now() - startedAt),
        llmCalls: 0
      }
    };
  }

  if (requestedStrategy === "pageindex-service") {
    return fallbackToLexical(input, requestedStrategy, startedAt, "service_not_configured");
  }

  if (!config.reasoningEnabled && !input.allowExperimental) {
    return fallbackToLexical(input, requestedStrategy, startedAt, "feature_disabled");
  }

  try {
    const candidate = await withTimeout(
      (signal) => retrieveWithTreeReasoning({
        ...input,
        model: input.model ?? config.reasoningModel,
        maxOutlineChars: config.maxOutlineChars,
        compactRefs: config.compactRefs,
        signal
      }),
      config.timeoutMs
    );
    const diagnostics: PageIndexRetrievalDiagnostics = {
      requestedStrategy,
      usedStrategy: "tree-reasoning",
      engineVersion: "pageindex-tree-reasoning-v1",
      selectedNodeIds: candidate.selectedNodeIds,
      latencyMs: round(performance.now() - startedAt),
      llmCalls: 1,
      candidateNodeCount: candidate.candidateNodeCount,
      outlineTruncated: candidate.outlineTruncated,
      outlineChars: candidate.outlineChars
    };
    logRetrieval(input, diagnostics, candidate.nodes.length);
    return { nodes: candidate.nodes, diagnostics };
  } catch (error) {
    const reason = error instanceof Error ? normalizeFallbackReason(error.message) : "unknown_error";
    return fallbackToLexical(input, requestedStrategy, startedAt, reason);
  }
}

async function retrieveWithTreeReasoning(
  input: DispatchPageIndexInput & {
    maxOutlineChars: number;
    compactRefs: boolean;
    signal?: AbortSignal;
  }
) {
  const topK = Math.min(Math.max(input.topK ?? 6, 1), 12);
  const documents = await listReadyDocuments({ tags: input.tags, slugs: input.documentSlugs });
  if (documents.length === 0) {
    return {
      nodes: [] as RetrievedNode[],
      selectedNodeIds: [] as string[],
      candidateNodeCount: 0,
      outlineTruncated: false,
      outlineChars: 0
    };
  }

  const rawNodes = await getAllNodesForDocuments(documents.map((document) => document._id));
  const forest = buildPageIndexForest(documents, rawNodes);
  const outlineResult = buildCompactOutline(forest, input.maxOutlineChars, {
    compactRefs: input.compactRefs
  });
  const selection = await selectPageIndexNodes({
    query: input.query,
    outline: outlineResult.outline,
    forest,
    refToKey: outlineResult.refToKey,
    topK,
    model: input.model,
    signal: input.signal
  });

  if (selection.insufficientEvidence) {
    return {
      nodes: [] as RetrievedNode[],
      selectedNodeIds: [] as string[],
      candidateNodeCount: rawNodes.length,
      outlineTruncated: outlineResult.truncated,
      outlineChars: outlineResult.outline.length
    };
  }
  if (selection.selected.length === 0) throw new Error("zero_valid_selection");

  const expanded = expandSelectedTreeNodes(
    forest,
    selection.selected.map((item) => ({ key: item.nodeKey, relevance: item.relevance })),
    topK
  );
  if (expanded.length === 0) throw new Error("zero_content_selection");

  return {
    nodes: expanded.map(({ treeNode, relevance }) => ({
      document: treeNode.document,
      node: treeNode.node,
      score: relevance
    })),
    selectedNodeIds: selection.selected.map((item) => item.nodeKey),
    candidateNodeCount: rawNodes.length,
    outlineTruncated: outlineResult.truncated,
    outlineChars: outlineResult.outline.length
  };
}

async function fallbackToLexical(
  input: DispatchPageIndexInput,
  requestedStrategy: PageIndexRetrievalStrategy,
  startedAt: number,
  fallbackReason: string
) {
  const nodes = await retrievePageIndexNodes(input);
  const diagnostics: PageIndexRetrievalDiagnostics = {
    requestedStrategy,
    usedStrategy: "lexical",
    fallbackReason,
    latencyMs: round(performance.now() - startedAt),
    llmCalls: requestedStrategy === "tree-reasoning" && fallbackReason !== "feature_disabled" ? 1 : 0
  };
  logRetrieval(input, diagnostics, nodes.length);
  return { nodes, diagnostics };
}

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("retrieval_timeout"));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function logRetrieval(
  input: DispatchPageIndexInput,
  diagnostics: PageIndexRetrievalDiagnostics,
  selectedNodeCount: number
) {
  console.info(
    JSON.stringify({
      event: "pageindex_retrieval",
      strategyRequested: diagnostics.requestedStrategy,
      strategyUsed: diagnostics.usedStrategy,
      engineVersion: diagnostics.engineVersion,
      documentCount: input.documentSlugs?.length,
      candidateNodeCount: diagnostics.candidateNodeCount,
      outlineChars: diagnostics.outlineChars,
      selectedNodeCount,
      latencyMs: diagnostics.latencyMs,
      llmCalls: diagnostics.llmCalls,
      fallbackReason: diagnostics.fallbackReason
    })
  );
}

function normalizeFallbackReason(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "unknown_error";
}

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
