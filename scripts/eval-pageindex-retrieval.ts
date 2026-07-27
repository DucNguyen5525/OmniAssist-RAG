import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { PageIndexRetrievalStrategy } from "@helpdesk/shared";
import { getPageIndexRetrievalConfig } from "../apps/web/lib/server/env";
import { closeMongoClient } from "../apps/web/lib/server/mongodb";
import { retrievePageIndex } from "../apps/web/lib/server/pageindex-retrieval";
import { getHelpdeskBySlug } from "../apps/web/lib/server/repository";

type Category = "exact" | "paraphrase" | "mixed" | "multi-section" | "image" | "no-answer";

interface RetrievalGoldenCase {
  id: string;
  question: string;
  helpdeskSlug: string;
  relevantNodeIds: string[];
  acceptableAncestorNodeIds?: string[];
  category: Category;
  notes?: string;
}

interface Args {
  helpdesk?: string;
  strategy: PageIndexRetrievalStrategy;
  topK: number;
  cases?: number;
  profile?: "spike";
  output?: string;
}

interface CaseResult {
  id: string;
  category: Category;
  question: string;
  relevantNodeIds: string[];
  retrievedNodeIds: string[];
  hitAt1: number;
  hitAt3: number;
  recallAtK: number;
  reciprocalRank: number;
  falsePositive: number;
  latencyMs: number;
  llmCalls: number;
  usedStrategy: PageIndexRetrievalStrategy;
  fallbackReason?: string;
  outlineChars?: number;
  outlineTruncated?: boolean;
}

async function main() {
  await loadRootEnv();
  const args = parseArgs(process.argv.slice(2));
  const datasetPath = path.resolve("evals/pageindex-retrieval-golden.json");
  const golden = JSON.parse(await fs.readFile(datasetPath, "utf8")) as RetrievalGoldenCase[];
  const filtered = golden.filter((item) => !args.helpdesk || item.helpdeskSlug === args.helpdesk);
  const selected = (
    args.profile === "spike"
      ? selectSpikeCases(filtered)
      : filtered
  ).slice(0, args.cases ?? golden.length);

  if (selected.length === 0) {
    throw new Error(`No golden cases found${args.helpdesk ? ` for helpdesk '${args.helpdesk}'` : ""}.`);
  }

  validateGoldenCases(selected);
  const helpdeskCache = new Map<string, Awaited<ReturnType<typeof getHelpdeskBySlug>>>();
  const results: CaseResult[] = [];

  for (const testCase of selected) {
    let helpdesk = helpdeskCache.get(testCase.helpdeskSlug);
    if (helpdesk === undefined) {
      helpdesk = await getHelpdeskBySlug(testCase.helpdeskSlug);
      helpdeskCache.set(testCase.helpdeskSlug, helpdesk);
    }
    if (!helpdesk) throw new Error(`Unknown helpdesk '${testCase.helpdeskSlug}' in case '${testCase.id}'.`);
    if (helpdesk.retrievalMode === "amg") {
      throw new Error(`Case '${testCase.id}' points to AMG helpdesk '${helpdesk.slug}'.`);
    }

    const startedAt = performance.now();
    const retrieval = await retrievePageIndex({
      query: testCase.question,
      tags: helpdesk.tags,
      documentSlugs: helpdesk.documentSlugs,
      topK: args.topK,
      strategy: args.strategy,
      allowExperimental: true
    });
    const latencyMs = performance.now() - startedAt;
    const retrievedNodeIds = retrieval.nodes.map((item) => item.node.nodeId);
    results.push(
      scoreCase(
        testCase,
        retrievedNodeIds,
        latencyMs,
        retrieval.diagnostics.llmCalls,
        retrieval.diagnostics.usedStrategy,
        retrieval.diagnostics.fallbackReason,
        retrieval.diagnostics.outlineChars,
        retrieval.diagnostics.outlineTruncated
      )
    );
  }

  const artifact = {
    timestamp: new Date().toISOString(),
    gitCommit: readGitCommit(),
    strategy: args.strategy,
    version: args.strategy === "lexical" ? "lexical-v1" : "pageindex-tree-reasoning-v1",
    model:
      args.strategy === "tree-reasoning"
        ? process.env.PAGEINDEX_REASONING_MODEL ?? process.env.GCLI_MODEL ?? null
        : null,
    configuration: getPageIndexRetrievalConfig(),
    topK: args.topK,
    caseCount: results.length,
    aggregate: summarize(results),
    categories: Object.fromEntries(
      [...new Set(results.map((item) => item.category))].map((category) => [
        category,
        summarize(results.filter((item) => item.category === category))
      ])
    ),
    cases: results
  };

  const outputPath = args.output
    ? path.resolve(args.output)
    : path.resolve("evals/results", `${fileTimestamp(artifact.timestamp)}-${args.strategy}.json`);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({ output: path.relative(process.cwd(), outputPath), ...artifact.aggregate }, null, 2));
}

function scoreCase(
  testCase: RetrievalGoldenCase,
  retrievedNodeIds: string[],
  latencyMs: number,
  llmCalls: number,
  usedStrategy: PageIndexRetrievalStrategy,
  fallbackReason?: string,
  outlineChars?: number,
  outlineTruncated?: boolean
): CaseResult {
  const relevant = new Set([...testCase.relevantNodeIds, ...(testCase.acceptableAncestorNodeIds ?? [])]);
  const isNoAnswer = testCase.category === "no-answer";
  const firstRelevantIndex = retrievedNodeIds.findIndex((nodeId) => relevant.has(nodeId));
  const matchedRequired = new Set(retrievedNodeIds.filter((nodeId) => testCase.relevantNodeIds.includes(nodeId)));

  return {
    id: testCase.id,
    category: testCase.category,
    question: testCase.question,
    relevantNodeIds: testCase.relevantNodeIds,
    retrievedNodeIds,
    hitAt1: isNoAnswer ? Number(retrievedNodeIds.length === 0) : Number(firstRelevantIndex === 0),
    hitAt3: isNoAnswer ? Number(retrievedNodeIds.length === 0) : Number(firstRelevantIndex >= 0 && firstRelevantIndex < 3),
    recallAtK: isNoAnswer
      ? Number(retrievedNodeIds.length === 0)
      : testCase.relevantNodeIds.length === 0
        ? 0
        : matchedRequired.size / testCase.relevantNodeIds.length,
    reciprocalRank: isNoAnswer ? Number(retrievedNodeIds.length === 0) : firstRelevantIndex >= 0 ? 1 / (firstRelevantIndex + 1) : 0,
    falsePositive: isNoAnswer ? Number(retrievedNodeIds.length > 0) : 0,
    latencyMs: round(latencyMs),
    llmCalls,
    usedStrategy,
    fallbackReason,
    outlineChars,
    outlineTruncated
  };
}

function summarize(results: CaseResult[]) {
  const latency = results.map((item) => item.latencyMs).sort((a, b) => a - b);
  const noAnswer = results.filter((item) => item.category === "no-answer");
  return {
    hitAt1: average(results.map((item) => item.hitAt1)),
    hitAt3: average(results.map((item) => item.hitAt3)),
    recallAtK: average(results.map((item) => item.recallAtK)),
    mrr: average(results.map((item) => item.reciprocalRank)),
    noAnswerFalsePositiveRate: noAnswer.length ? average(noAnswer.map((item) => item.falsePositive)) : null,
    llmCallsPerQuery: average(results.map((item) => item.llmCalls)),
    fallbackRate: average(results.map((item) => Number(Boolean(item.fallbackReason)))),
    latencyMs: {
      p50: percentile(latency, 0.5),
      p95: percentile(latency, 0.95),
      max: latency.at(-1) ?? 0
    }
  };
}

function validateGoldenCases(cases: RetrievalGoldenCase[]) {
  const seen = new Set<string>();
  for (const item of cases) {
    if (seen.has(item.id)) throw new Error(`Duplicate golden case id '${item.id}'.`);
    seen.add(item.id);
    if (item.category === "no-answer" && item.relevantNodeIds.length > 0) {
      throw new Error(`No-answer case '${item.id}' must not contain relevant node IDs.`);
    }
    if (item.category !== "no-answer" && item.relevantNodeIds.length === 0) {
      throw new Error(`Retrieval case '${item.id}' must contain at least one relevant node ID.`);
    }
  }
}

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith("--") || !value || value.startsWith("--")) continue;
    values.set(key.slice(2), value);
    index += 1;
  }

  const strategy = values.get("strategy") ?? "lexical";
  if (!["lexical", "tree-reasoning", "pageindex-service"].includes(strategy)) {
    throw new Error(`Unknown strategy '${strategy}'.`);
  }
  return {
    helpdesk: values.get("helpdesk"),
    strategy: strategy as PageIndexRetrievalStrategy,
    topK: clampInteger(values.get("top-k"), 6, 1, 12),
    cases: values.has("cases") ? clampInteger(values.get("cases"), 50, 1, 500) : undefined,
    profile: values.get("profile") === "spike" ? "spike" : undefined,
    output: values.get("output")
  };
}

function selectSpikeCases(cases: RetrievalGoldenCase[]) {
  const quotas: Record<Category, number> = {
    exact: 3,
    paraphrase: 4,
    mixed: 2,
    "multi-section": 2,
    image: 1,
    "no-answer": 3
  };
  const selected: RetrievalGoldenCase[] = [];
  for (const category of Object.keys(quotas) as Category[]) {
    selected.push(...cases.filter((item) => item.category === category).slice(0, quotas[category]));
  }
  return selected;
}

function clampInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function average(values: number[]) {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function percentile(sortedValues: number[], quantile: number) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(Math.ceil(sortedValues.length * quantile) - 1, sortedValues.length - 1);
  return round(sortedValues[Math.max(index, 0)]);
}

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function fileTimestamp(value: string) {
  return value.replace(/[:.]/g, "-");
}

function readGitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function loadRootEnv() {
  const envPath = path.resolve(".env");
  try {
    const contents = await fs.readFile(envPath, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = stripQuotes(match[2]);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function stripQuotes(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient().catch(() => undefined);
  });
