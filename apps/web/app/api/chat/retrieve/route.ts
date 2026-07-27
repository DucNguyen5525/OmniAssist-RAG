import { NextResponse } from "next/server";
import { z } from "zod";
import { retrievePageIndex } from "@/lib/server/pageindex-retrieval";
import { toRetrievalResponseItem } from "@/lib/server/retrieval";

export const runtime = "nodejs";

const retrievalSchema = z.object({
  query: z.string().min(1),
  tags: z.array(z.string()).optional(),
  documentSlugs: z.array(z.string()).optional(),
  strategy: z.enum(["lexical", "tree-reasoning", "pageindex-service"]).optional(),
  topK: z.number().int().min(1).max(12).optional()
});

export async function POST(request: Request) {
  try {
    const input = retrievalSchema.parse(await request.json());
    const result = await retrievePageIndex(input);
    return NextResponse.json({
      data: result.nodes.map(toRetrievalResponseItem),
      diagnostics: result.diagnostics
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ detail: "Validation failed", errors: error.flatten() }, { status: 422 });
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
