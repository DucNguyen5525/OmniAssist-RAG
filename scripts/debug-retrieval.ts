import { routeDocuments } from "../apps/web/lib/server/doc-router";
import { buildGroundedPrompt } from "../apps/web/lib/server/gemini";
import { getMongoClient } from "../apps/web/lib/server/mongodb";
import { getHelpdeskBySlug, getNodesForDocuments, listReadyDocuments } from "../apps/web/lib/server/repository";
import { scoreCandidates, type RetrievedNode } from "../apps/web/lib/server/retrieval";

interface Args {
  helpdesk?: string;
  slugs?: string;
  tags?: string;
  top: number;
  noRoute: boolean;
  showPrompt: boolean;
  question: string;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.question) {
    throw new Error('Usage: npm run debug:retrieval -- --helpdesk tech-support "cau hoi" [--slugs a,b] [--tags x,y] [--top 15] [--no-route] [--show-prompt]');
  }

  // Resolve scope the same way /api/chat does (apps/web/app/api/chat/route.ts)
  let tags: string[] | undefined;
  let documentSlugs: string[] | undefined;
  let topK = 6;
  let systemPrompt: string | undefined;
  let model: string | undefined;

  if (args.helpdesk) {
    const helpdesk = await getHelpdeskBySlug(args.helpdesk);
    if (!helpdesk) throw new Error(`Helpdesk '${args.helpdesk}' not found`);
    const merged = [...new Set([...(helpdesk.tags ?? []), ...splitList(args.tags)])];
    tags = merged.length > 0 ? merged : undefined;
    topK = helpdesk.topK ?? topK;
    systemPrompt = helpdesk.systemPrompt;
    model = helpdesk.model;
    documentSlugs = helpdesk.documentSlugs?.length ? helpdesk.documentSlugs : undefined;
    console.log(`Helpdesk: ${helpdesk.slug} | topK=${topK} | tags=[${(tags ?? []).join(", ")}] | documentSlugs=[${(documentSlugs ?? []).join(", ")}]`);
  } else {
    tags = splitList(args.tags).length > 0 ? splitList(args.tags) : undefined;
  }
  if (args.slugs) documentSlugs = splitList(args.slugs);

  console.log(`Question: ${args.question}\n`);

  // Stage 1: candidates + routing
  const candidates = await listReadyDocuments({ tags, slugs: documentSlugs });
  console.log(`Candidate documents (${candidates.length}):`);
  for (const doc of candidates) {
    console.log(`  - ${doc.slug} | ${doc.title} | docSummary: ${doc.docSummary ? "yes" : "NO"}`);
  }
  if (candidates.length === 0) {
    console.log("\nNo ready documents match this scope — check helpdesk documentSlugs/tags and document status.");
    return;
  }

  let routedSlugs = candidates.map((doc) => doc.slug);
  if (args.noRoute) {
    console.log("\nRouting: skipped (--no-route), using all candidates");
  } else if (candidates.length === 1) {
    console.log("\nRouting: skipped (1 candidate)");
  } else {
    routedSlugs = await routeDocuments(args.question, candidates, model);
    console.log(`\nRouting: LLM routed to [${routedSlugs.join(", ")}]`);
  }

  // Stage 2: score every node in the routed documents (production keeps score>0, topK)
  const routedDocs = candidates.filter((doc) => routedSlugs.includes(doc.slug));
  const documentById = new Map(routedDocs.map((doc) => [doc._id.toString(), doc]));
  const nodes = await getNodesForDocuments(routedDocs.map((doc) => doc._id));
  const scores = scoreCandidates(args.question, nodes);

  const scored = nodes
    .map((node, index) => ({ node, document: documentById.get(node.documentId.toString())!, score: scores[index] }))
    .sort((a, b) => b.score - a.score);

  const effectiveTopK = Math.min(Math.max(topK, 1), 12);
  const picked = new Set(scored.filter((item) => item.score > 0).slice(0, effectiveTopK));

  console.log(`\nScored nodes (top ${args.top} of ${scored.length}; ✓ = returned by production retrieval, topK=${effectiveTopK}):`);
  for (const item of scored.slice(0, args.top)) {
    const mark = picked.has(item) ? "✓" : " ";
    const path = item.node.path?.length ? ` | ${truncate(item.node.path.join(" > "), 60)}` : "";
    console.log(`  ${mark} ${item.score.toFixed(1).padStart(6)} | ${item.document.slug} | L${item.node.level} | ${truncate(item.node.title, 50)}${path}`);
  }
  if (picked.size === 0) {
    console.log("  (no node scored > 0 — the chat would answer with the no-context fallback)");
  }

  if (args.showPrompt) {
    const retrieved: RetrievedNode[] = scored.filter((item) => picked.has(item));
    console.log("\n===== FINAL PROMPT =====\n");
    console.log(buildGroundedPrompt(args.question, retrieved, systemPrompt));
  }
}

function parseArgs(argv: string[]): Args {
  const args: Args = { top: 15, noRoute: false, showPrompt: false, question: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) {
      args.question = args.question ? `${args.question} ${key}` : key;
      continue;
    }
    if (key === "--no-route") { args.noRoute = true; continue; }
    if (key === "--show-prompt") { args.showPrompt = true; continue; }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) continue;
    i += 1;
    if (key === "--top") args.top = Number(value) || args.top;
    else if (key === "--helpdesk") args.helpdesk = value;
    else if (key === "--slugs") args.slugs = value;
    else if (key === "--tags") args.tags = value;
  }
  return args;
}

function splitList(value?: string) {
  return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
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
