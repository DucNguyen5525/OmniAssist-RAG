import { NextResponse } from "next/server";
import type { ChatStreamEvent, RetrievalMode, SourceReference } from "@helpdesk/shared";
import { z } from "zod";
import { routeDocuments } from "@/lib/server/doc-router";
import { generateGroundedAnswer, generateGroundedAnswerStream } from "@/lib/server/gemini";
import { rewriteFollowupQuestion } from "@/lib/server/question-rewriter";
import {
  addMessage,
  createConversation,
  getDatasetBySlug,
  getDatasetRows,
  getHelpdeskBySlug,
  listMessages,
  listReadyDocuments
} from "@/lib/server/repository";
import { retrievePageIndexNodes, toSourceReference } from "@/lib/server/retrieval";
import { generateTabularAnswer } from "@/lib/server/tabular-qa";

export const runtime = "nodejs";

const MAX_QUESTIONS_PER_SESSION = 6;

const chatSchema = z.object({
  question: z.string().min(1),
  conversationId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  topK: z.number().int().min(1).max(12).optional(),
  helpdeskSlug: z.string().optional(),
  retrievalMode: z.enum(["pageindex", "amg"]).optional(),
  model: z.string().max(100).optional(),
  stream: z.boolean().optional()
});

export async function POST(request: Request) {
  try {
    const input = chatSchema.parse(await request.json());
    // History fetched before saving the new user message, so it holds prior turns only.
    const history = input.conversationId ? await listMessages(input.conversationId) : [];
    const priorQuestionCount = history.filter((message) => message.role === "user").length;
    if (priorQuestionCount >= MAX_QUESTIONS_PER_SESSION) {
      return NextResponse.json(
        { detail: `This chat session has reached the ${MAX_QUESTIONS_PER_SESSION}-question limit. Please start a new session.` },
        { status: 429 }
      );
    }

    const conversation = input.conversationId
      ? { id: input.conversationId }
      : await createConversation(input.question.slice(0, 80));

    await addMessage({ conversationId: conversation.id, role: "user", content: input.question });

    let tags = input.tags;
    let topK = input.topK;
    let systemPrompt: string | undefined;
    let retrievalMode: RetrievalMode = input.retrievalMode ?? "pageindex";
    let datasetSlug: string | undefined;
    let model = input.model;
    let documentSlugs: string[] | undefined;

    if (input.helpdeskSlug) {
      const helpdesk = await getHelpdeskBySlug(input.helpdeskSlug);
      if (helpdesk) {
        const helpdeskTags = helpdesk.tags ?? [];
        const explicitTags = input.tags ?? [];
        const mergedTags = [...new Set([...helpdeskTags, ...explicitTags])];
        tags = mergedTags.length > 0 ? mergedTags : undefined;
        topK = input.topK ?? helpdesk.topK;
        systemPrompt = helpdesk.systemPrompt;
        retrievalMode = input.retrievalMode ?? helpdesk.retrievalMode ?? "pageindex";
        datasetSlug = helpdesk.datasetSlug ?? input.helpdeskSlug;
        model = input.model ?? helpdesk.model;
        documentSlugs = helpdesk.documentSlugs?.length ? helpdesk.documentSlugs : undefined;
      }
    }

    // Follow-up turns lose their subject without history: rewrite into a standalone
    // question for routing/retrieval/generation. The saved user message stays original.
    let question = input.question;
    if (history.length > 0) {
      question = await rewriteFollowupQuestion(input.question, history, model);
      if (question !== input.question) {
        console.log(`Follow-up rewritten for retrieval: "${input.question}" -> "${question}"`);
      }
    }

    if (retrievalMode === "amg") {
      const result = await answerWithDataset(question, datasetSlug, systemPrompt, model);
      const saved = await addMessage({ conversationId: conversation.id, role: "assistant", content: result.answer, sources: result.sources });
      if (input.stream) {
        // AMG numbers are computed in TS, not streamed: emit the finished answer as one delta.
        return ndjsonResponse([
          { type: "meta", conversationId: conversation.id, sources: result.sources },
          { type: "delta", text: result.answer },
          { type: "done", messageId: saved.id }
        ]);
      }
      return NextResponse.json({ conversationId: conversation.id, answer: result.answer, sources: result.sources, messageId: saved.id });
    }

    // Stage 1: with several candidate documents, let the LLM route the question first.
    let routedSlugs = documentSlugs;
    const candidates = await listReadyDocuments({ tags, slugs: documentSlugs });
    if (candidates.length > 1) {
      routedSlugs = await routeDocuments(question, candidates, model);
    } else if (candidates.length === 1) {
      routedSlugs = [candidates[0].slug];
    }

    // Stage 2: lexical PageIndex retrieval inside the routed documents.
    const retrieved = await retrievePageIndexNodes({ query: question, tags, documentSlugs: routedSlugs, topK });
    const sources = retrieved.map(toSourceReference);

    if (!input.stream) {
      const answer = await generateGroundedAnswer(question, retrieved, systemPrompt, model);
      const saved = await addMessage({ conversationId: conversation.id, role: "assistant", content: answer, sources });
      return NextResponse.json({ conversationId: conversation.id, answer, sources, messageId: saved.id });
    }

    const conversationId = conversation.id;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: ChatStreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        try {
          send({ type: "meta", conversationId, sources });
          let fullAnswer = "";
          for await (const delta of generateGroundedAnswerStream(question, retrieved, systemPrompt, model)) {
            fullAnswer += delta;
            send({ type: "delta", text: delta });
          }
          const saved = await addMessage({ conversationId, role: "assistant", content: fullAnswer.trim(), sources });
          send({ type: "done", messageId: saved.id });
        } catch (error) {
          send({ type: "error", message: error instanceof Error ? error.message : "Unexpected error" });
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache"
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}

function ndjsonResponse(events: ChatStreamEvent[]) {
  const body = events.map((event) => `${JSON.stringify(event)}\n`).join("");
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache"
    }
  });
}

async function answerWithDataset(
  question: string,
  datasetSlug: string | undefined,
  systemPrompt?: string,
  model?: string
): Promise<{ answer: string; sources: SourceReference[] }> {
  if (!datasetSlug) {
    return { answer: "Helpdesk này chưa được gắn bộ dữ liệu để trả lời theo chế độ dữ liệu bảng.", sources: [] };
  }
  const dataset = await getDatasetBySlug(datasetSlug);
  if (!dataset) {
    return { answer: `Không tìm thấy bộ dữ liệu '${datasetSlug}'.`, sources: [] };
  }
  const rows = await getDatasetRows(dataset._id);
  return generateTabularAnswer(question, dataset, rows, systemPrompt, model);
}

function handleApiError(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ detail: "Validation failed", errors: error.flatten() }, { status: 422 });
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  return NextResponse.json({ detail: message }, { status: 500 });
}
