import { NextResponse } from "next/server";
import { z } from "zod";
import { createHelpdesk, listHelpdesks } from "@/lib/server/repository";

export const runtime = "nodejs";

const createHelpdeskSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  topK: z.number().int().min(1).max(12).optional(),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
  retrievalMode: z.enum(["pageindex", "amg"]).optional(),
  datasetSlug: z.string().optional()
});

export async function GET() {
  try {
    const helpdesks = await listHelpdesks();
    return NextResponse.json({ data: helpdesks });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const input = createHelpdeskSchema.parse(await request.json());
    const helpdesk = await createHelpdesk(input);
    return NextResponse.json({ data: helpdesk }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ detail: "Validation failed", errors: error.flatten() }, { status: 422 });
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = message.includes("already exists") ? 409 : 500;
    return NextResponse.json({ detail: message }, { status });
  }
}
