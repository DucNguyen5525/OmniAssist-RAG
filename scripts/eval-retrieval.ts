import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getMongoClient } from "../apps/web/lib/server/mongodb";
import { getHelpdeskBySlug } from "../apps/web/lib/server/repository";
import { aggregate, type QueryResult } from "../apps/web/lib/server/retrieval-metrics";
import { normalize, retrievePageIndexNodes, retrievePageIndexNodesExpanded, type RetrievedNode } from "../apps/web/lib/server/retrieval";
import { expandQuery } from "../apps/web/lib/server/query-expansion";

// Offline retrieval quality baseline. Runs the production `retrievePageIndexNodes`
// scorer (no LLM routing, so numbers are deterministic) against a hand-written gold
// set and prints hit@k / recall@k / MRR. Re-run after any retrieval change to prove
// the change helps instead of guessing. See scripts/retrieval-goldset.json.

interface Expected {
  documentSlug?: string;
  nodeIds?: string[];
  keywords?: string[];
}

interface GoldCase {
  question: string;
  helpdesk?: string;
  tags?: string[];
  documentSlugs?: string[];
  topK?: number;
  expected: Expected;
}

interface GoldSet {
  cases: GoldCase[];
}

async function resolveScope(gold: GoldCase) {
  let tags = gold.tags;
  let documentSlugs = gold.documentSlugs;
  let topK = gold.topK;

  if (gold.helpdesk) {
    const helpdesk = await getHelpdeskBySlug(gold.helpdesk);
    if (!helpdesk) throw new Error(`Helpdesk '${gold.helpdesk}' not found`);
    const merged = [...new Set([...(helpdesk.tags ?? []), ...(tags ?? [])])];
    tags = merged.length > 0 ? merged : undefined;
    topK = topK ?? helpdesk.topK;
    documentSlugs = documentSlugs ?? (helpdesk.documentSlugs?.length ? helpdesk.documentSlugs : undefined);
  }

  return { tags, documentSlugs, topK: topK ?? 6 };
}

// A node counts as relevant when it satisfies every criterion the gold entry provides.
function isRelevant(item: RetrievedNode, expected: Expected): boolean {
  if (expected.documentSlug && item.document.slug !== expected.documentSlug) return false;
  if (expected.nodeIds?.length && !expected.nodeIds.includes(item.node._id.toString())) return false;
  if (expected.keywords?.length) {
    const haystack = normalize(`${item.node.title} ${item.node.summary ?? ""} ${item.node.content ?? ""}`);
    if (!expected.keywords.every((keyword) => haystack.includes(normalize(keyword)))) return false;
  }
  return true;
}

function totalRelevant(expected: Expected): number {
  return expected.nodeIds?.length ? expected.nodeIds.length : 1;
}

// Without at least one usable criterion, isRelevant() marks every node relevant and
// the metrics come out a meaningless 1.000. Fail loudly so gold entries stay honest.
function hasUsableExpectation(expected: Expected): boolean {
  return Boolean(expected.documentSlug || expected.nodeIds?.length || expected.keywords?.length);
}

function pad(value: string, width: number) {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

async function main() {
  // Default gold set, overridable with `--goldset <path>` (handy for trying candidate cases).
  const goldArgIndex = process.argv.indexOf("--goldset");
  const goldPath = goldArgIndex !== -1 && process.argv[goldArgIndex + 1]
    ? process.argv[goldArgIndex + 1]
    : fileURLToPath(new URL("./retrieval-goldset.json", import.meta.url));
  const goldSet = JSON.parse(readFileSync(goldPath, "utf8")) as GoldSet;
  const cases = goldSet.cases ?? [];
  if (cases.length === 0) throw new Error("No cases in scripts/retrieval-goldset.json");

  const unusable = cases.filter((gold) => !hasUsableExpectation(gold.expected));
  if (unusable.length > 0) {
    throw new Error(
      `${unusable.length} gold case(s) have an empty 'expected' (need documentSlug, nodeIds, or keywords). ` +
        `First: "${unusable[0].question}". Fill them in scripts/retrieval-goldset.json.`
    );
  }

  // Opt-in: run the same gold set through LLM query expansion (Phase 1) so its effect can
  // be compared against the plain baseline. One Gemini call per question; fail-open (an
  // empty expansion falls back to the baseline scorer for that question).
  const useExpansion = process.argv.includes("--expand") || process.env.EXPAND === "1";

  const results: QueryResult[] = [];
  console.log(
    `Evaluating ${cases.length} question(s) against production retrieval` +
      `${useExpansion ? " WITH query expansion" : ""}\n`
  );
  console.log(`${pad("hit", 5)}${pad("rank", 6)}${pad("topK", 6)}question`);
  console.log("-".repeat(72));

  for (const gold of cases) {
    const scope = await resolveScope(gold);
    const expansions = useExpansion ? await expandQuery(gold.question) : [];
    const retrieved = expansions.length > 0
      ? await retrievePageIndexNodesExpanded({
          query: gold.question,
          tags: scope.tags,
          documentSlugs: scope.documentSlugs,
          topK: scope.topK,
          expansions
        })
      : await retrievePageIndexNodes({
          query: gold.question,
          tags: scope.tags,
          documentSlugs: scope.documentSlugs,
          topK: scope.topK
        });
    const relevance = retrieved.map((item) => isRelevant(item, gold.expected));
    results.push({ relevance, totalRelevant: totalRelevant(gold.expected) });

    const firstHit = relevance.findIndex(Boolean);
    const hitMark = firstHit === -1 ? "·" : "✓";
    const rank = firstHit === -1 ? "-" : String(firstHit + 1);
    console.log(`${pad(hitMark, 5)}${pad(rank, 6)}${pad(String(retrieved.length), 6)}${gold.question}`);
  }

  const k = Math.max(...cases.map((gold) => gold.topK ?? 6), 1);
  const metrics = aggregate(results, k);
  console.log("\nAggregate metrics (averaged over all questions):");
  console.log(`  queries      : ${metrics.queries}`);
  console.log(`  k            : ${metrics.k}`);
  console.log(`  hit@k        : ${metrics.hitAtK.toFixed(3)}`);
  console.log(`  recall@k     : ${metrics.recallAtK.toFixed(3)}`);
  console.log(`  precision@k  : ${metrics.precisionAtK.toFixed(3)}`);
  console.log(`  MRR          : ${metrics.mrr.toFixed(3)}`);
  console.log(`\nJSON: ${JSON.stringify(metrics)}`);
}

main()
  .then(async () => {
    const client = await getMongoClient();
    await client.close();
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
