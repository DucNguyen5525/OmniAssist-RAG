import { NextResponse } from "next/server";
import { isRequestAdmin } from "@/lib/server/auth";
import { generateDocSummary } from "@/lib/server/doc-router";
import { getDocumentBySlug, listDocumentNodeRecords, updateDocumentMeta } from "@/lib/server/repository";

export const runtime = "nodejs";

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
    const nodes = await listDocumentNodeRecords(record._id);
    const docSummary = await generateDocSummary(record.title, nodes);
    const document = await updateDocumentMeta(slug, { docSummary });
    return NextResponse.json({ data: document });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
