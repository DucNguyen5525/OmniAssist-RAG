import { NextResponse } from "next/server";
import type { RetrievalDebugNode, RetrievalDebugResponse } from "@helpdesk/shared";
import { z } from "zod";
import { routeDocuments } from "@/lib/server/doc-router";
import { buildGroundedPrompt } from "@/lib/server/gemini";
import { getHelpdeskBySlug, getNodesForDocuments, listReadyDocuments } from "@/lib/server/repository";
import { scoreCandidates, type RetrievedNode } from "@/lib/server/retrieval";

export const runtime = "nodejs";

const debugSchema = z.object({
  question: z.string().min(1),
  helpdeskSlug: z.string().optional(),
  tags: z.array(z.string()).optional(),
  topK: z.number().int().min(1).max(12).optional(),
  documentSlugs: z.array(z.string()).optional(),
  top: z.number().int().min(1).max(100).optional(),
  noRoute: z.boolean().optional(),
  model: z.string().max(100).optional()
});

export async function POST(request: Request) {
  try {
    const input = debugSchema.parse(await request.json());
    const data = await buildRetrievalDebug(input);
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ detail: "Validation failed", errors: error.flatten() }, { status: 422 });
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ detail: message }, { status });
  }
}

async function buildRetrievalDebug(input: z.infer<typeof debugSchema>): Promise<RetrievalDebugResponse> {
  let tags = input.tags;
  let topK = input.topK ?? 6;
  let systemPrompt: string | undefined;
  let model = input.model;
  let documentSlugs = input.documentSlugs?.length ? input.documentSlugs : undefined;

  if (input.helpdeskSlug) {
    const helpdesk = await getHelpdeskBySlug(input.helpdeskSlug);
    if (!helpdesk) throw new Error(`Helpdesk '${input.helpdeskSlug}' not found`);
    const mergedTags = [...new Set([...(helpdesk.tags ?? []), ...(input.tags ?? [])])];
    tags = mergedTags.length > 0 ? mergedTags : undefined;
    topK = input.topK ?? helpdesk.topK ?? topK;
    systemPrompt = helpdesk.systemPrompt;
    model = input.model ?? helpdesk.model;
    documentSlugs = input.documentSlugs?.length
      ? input.documentSlugs
      : helpdesk.documentSlugs?.length
        ? helpdesk.documentSlugs
        : undefined;
  }

  const effectiveTopK = Math.min(Math.max(topK, 1), 12);
  const candidates = await listReadyDocuments({ tags, slugs: documentSlugs });
  let routedSlugs = candidates.map((doc) => doc.slug);
  let routingStatus: RetrievalDebugResponse["routing"]["status"] = "no_candidates";

  if (candidates.length === 0) {
    return {
      question: input.question,
      scope: {
        helpdeskSlug: input.helpdeskSlug,
        topK: effectiveTopK,
        tags: tags ?? [],
        documentSlugs: documentSlugs ?? []
      },
      routing: { status: routingStatus, routedSlugs: [] },
      candidates: [],
      nodes: [],
      selectedCount: 0,
      totalScoredNodes: 0,
      prompt: buildGroundedPrompt(input.question, [], systemPrompt)
    };
  }

  if (input.noRoute) {
    routingStatus = "skipped_no_route";
  } else if (candidates.length === 1) {
    routingStatus = "skipped_single_candidate";
  } else {
    routedSlugs = await routeDocuments(input.question, candidates, model);
    routingStatus = "routed";
  }

  const routedDocs = candidates.filter((doc) => routedSlugs.includes(doc.slug));
  const documentById = new Map(routedDocs.map((doc) => [doc._id.toString(), doc]));
  const nodes = await getNodesForDocuments(routedDocs.map((doc) => doc._id));
  const scores = scoreCandidates(input.question, nodes);
  const scored = nodes
    .map((node, index) => ({
      node,
      document: documentById.get(node.documentId.toString()),
      score: scores[index]
    }))
    .filter((item): item is RetrievedNode => Boolean(item.document))
    .sort((a, b) => b.score - a.score);

  const selected = scored.filter((item) => item.score > 0).slice(0, effectiveTopK);
  const selectedKeys = new Set(selected.map((item) => `${item.document._id.toString()}:${item.node.nodeId}`));
  const visibleNodes: RetrievalDebugNode[] = scored.slice(0, input.top ?? 25).map((item, index) => {
    const key = `${item.document._id.toString()}:${item.node.nodeId}`;
    return {
      rank: index + 1,
      selected: selectedKeys.has(key),
      score: item.score,
      documentSlug: item.document.slug,
      documentTitle: item.document.title,
      nodeId: item.node.nodeId,
      nodeTitle: item.node.title,
      path: item.node.path ?? [],
      level: item.node.level,
      pageStart: item.node.pageStart,
      pageEnd: item.node.pageEnd,
      sourceRef: item.node.sourceRef,
      summary: item.node.summary,
      content: item.node.content
    };
  });

  return {
    question: input.question,
    scope: {
      helpdeskSlug: input.helpdeskSlug,
      topK: effectiveTopK,
      tags: tags ?? [],
      documentSlugs: documentSlugs ?? []
    },
    routing: { status: routingStatus, routedSlugs },
    candidates: candidates.map((doc) => ({
      slug: doc.slug,
      title: doc.title,
      hasSummary: Boolean(doc.docSummary),
      routed: routedSlugs.includes(doc.slug)
    })),
    nodes: visibleNodes,
    selectedCount: selected.length,
    totalScoredNodes: scored.length,
    prompt: buildGroundedPrompt(input.question, selected, systemPrompt)
  };
}
