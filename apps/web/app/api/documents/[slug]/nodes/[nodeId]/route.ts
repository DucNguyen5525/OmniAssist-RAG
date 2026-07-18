import { NextResponse } from "next/server";
import { z } from "zod";
import { isRequestAdmin } from "@/lib/server/auth";
import { deleteDocumentNode, getDocumentBySlug, updateDocumentNode } from "@/lib/server/repository";

export const runtime = "nodejs";

const updateNodeSchema = z.object({
  title: z.string().min(1).optional(),
  summary: z.string().optional(),
  content: z.string().optional()
});

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string; nodeId: string }> }) {
  if (!isRequestAdmin(request)) {
    return NextResponse.json({ detail: "Forbidden" }, { status: 403 });
  }

  try {
    const { slug, nodeId } = await params;
    const record = await getDocumentBySlug(slug);
    if (!record) {
      return NextResponse.json({ detail: "Document not found" }, { status: 404 });
    }
    const input = updateNodeSchema.parse(await request.json());
    const node = await updateDocumentNode(record._id, decodeURIComponent(nodeId), input);
    if (!node) {
      return NextResponse.json({ detail: "Node not found" }, { status: 404 });
    }
    return NextResponse.json({ data: node });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ detail: "Validation failed", errors: error.flatten() }, { status: 422 });
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string; nodeId: string }> }) {
  if (!isRequestAdmin(request)) {
    return NextResponse.json({ detail: "Forbidden" }, { status: 403 });
  }

  try {
    const { slug, nodeId } = await params;
    const record = await getDocumentBySlug(slug);
    if (!record) {
      return NextResponse.json({ detail: "Document not found" }, { status: 404 });
    }
    const result = await deleteDocumentNode(record._id, decodeURIComponent(nodeId));
    if (result === "not_found") {
      return NextResponse.json({ detail: "Node not found" }, { status: 404 });
    }
    if (result === "has_children") {
      return NextResponse.json({ detail: "Node still has children; delete or move them first" }, { status: 409 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
