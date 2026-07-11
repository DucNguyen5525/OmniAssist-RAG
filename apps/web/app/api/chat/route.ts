import { NextResponse } from "next/server";
import type { RetrievalMode, SourceReference } from "@helpdesk/shared";
import { z } from "zod";
import { generateGroundedAnswer } from "@/lib/server/gemini";
import {
  addMessage,
  createConversation,
  getDatasetBySlug,
  getDatasetRows,
  getHelpdeskBySlug
} from "@/lib/server/repository";
import { retrievePageIndexNodes, toSourceReference } from "@/lib/server/retrieval";
import { generateTabularAnswer } from "@/lib/server/tabular-qa";

export const runtime = "nodejs";

const chatSchema = z.object({
  question: z.string().min(1),
  conversationId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  topK: z.number().int().min(1).max(12).optional(),
  helpdeskSlug: z.string().optional(),
  retrievalMode: z.enum(["pageindex", "amg"]).optional(),
  model: z.string().max(100).optional()
});

export async function POST(request: Request) {
  try {
    const input = chatSchema.parse(await request.json());
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
      }
    }

    let answer: string;
    let sources: SourceReference[];

    if (retrievalMode === "amg") {
      const result = await answerWithDataset(input.question, datasetSlug, systemPrompt, model);
      answer = result.answer;
      sources = result.sources;
    } else {
      const retrieved = await retrievePageIndexNodes({ query: input.question, tags, topK });
      answer = await generateGroundedAnswer(input.question, retrieved, systemPrompt, model);
      sources = retrieved.map(toSourceReference);
    }

    await addMessage({ conversationId: conversation.id, role: "assistant", content: answer, sources });

    return NextResponse.json({
      conversationId: conversation.id,
      answer,
      sources
    });
  } catch (error) {
    return handleApiError(error);
  }
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
