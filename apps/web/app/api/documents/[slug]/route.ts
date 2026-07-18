import { NextResponse } from "next/server";
import { z } from "zod";
import { isRequestAdmin } from "@/lib/server/auth";
import { getDocumentBySlug, serializeDocument, updateDocumentMeta } from "@/lib/server/repository";

export const runtime = "nodejs";

const updateDocumentSchema = z.object({
  title: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  version: z.string().optional()
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
    return NextResponse.json({ data: serializeDocument(record) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!isRequestAdmin(request)) {
    return NextResponse.json({ detail: "Forbidden" }, { status: 403 });
  }

  try {
    const { slug } = await params;
    const input = updateDocumentSchema.parse(await request.json());
    const document = await updateDocumentMeta(slug, input);
    if (!document) {
      return NextResponse.json({ detail: "Document not found" }, { status: 404 });
    }
    return NextResponse.json({ data: document });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ detail: "Validation failed", errors: error.flatten() }, { status: 422 });
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
