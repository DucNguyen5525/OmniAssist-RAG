import { NextResponse } from "next/server";
import { isRequestAdmin } from "@/lib/server/auth";
import { buildPageIndexTree } from "@/lib/server/pageindex-export";
import { getDocumentBySlug, listDocumentNodeRecords } from "@/lib/server/repository";

export const runtime = "nodejs";

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
    const tree = buildPageIndexTree(record.title, nodes);
    return new NextResponse(JSON.stringify(tree, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${slug}-pageindex.json"`
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
