import { NextResponse } from "next/server";
import { z } from "zod";
import { isRequestAdmin } from "@/lib/server/auth";
import { createDocumentNode, getDocumentBySlug, listDocumentNodeRecords, serializeDocument, serializeNode } from "@/lib/server/repository";

export const runtime = "nodejs";

const createNodeSchema = z.object({
  parentNodeId: z.string().optional(),
  title: z.string().min(1),
  summary: z.string().optional(),
  content: z.string().min(1)
});

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!isRequestAdmin(request)) {
    return NextResponse.json({ detail: "Forbidden" }, { status: 403 });
  }

  try {
    const { slug } = await params;
    const record = await getDocumentBySlug(slug);
    if (!record) {
      return NextResponse.json({ detail: "Document not found" }, { status: 404 });
    }
    const nodes = await listDocumentNodeRecords(record._id);
    return NextResponse.json({ data: { document: serializeDocument(record), nodes: nodes.map(serializeNode) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!isRequestAdmin(request)) {
    return NextResponse.json({ detail: "Forbidden" }, { status: 403 });
  }

  try {
    const { slug } = await params;
    const record = await getDocumentBySlug(slug);
    if (!record) {
      return NextResponse.json({ detail: "Document not found" }, { status: 404 });
    }
    const input = createNodeSchema.parse(await request.json());
    const node = await createDocumentNode(record._id, input);
    return NextResponse.json({ data: node }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ detail: "Validation failed", errors: error.flatten() }, { status: 422 });
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
