import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteHelpdesk, getHelpdeskBySlug, updateHelpdesk } from "@/lib/server/repository";

export const runtime = "nodejs";

const updateHelpdeskSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  topK: z.number().int().min(1).max(12).optional(),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
  retrievalMode: z.enum(["pageindex", "amg"]).optional(),
  datasetSlug: z.string().optional()
});

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const helpdesk = await getHelpdeskBySlug(slug);
    if (!helpdesk) {
      return NextResponse.json({ detail: "Helpdesk not found" }, { status: 404 });
    }
    return NextResponse.json({ data: helpdesk });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const input = updateHelpdeskSchema.parse(await request.json());
    const helpdesk = await updateHelpdesk(slug, input);
    if (!helpdesk) {
      return NextResponse.json({ detail: "Helpdesk not found" }, { status: 404 });
    }
    return NextResponse.json({ data: helpdesk });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ detail: "Validation failed", errors: error.flatten() }, { status: 422 });
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const deleted = await deleteHelpdesk(slug);
    if (!deleted) {
      return NextResponse.json({ detail: "Helpdesk not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
