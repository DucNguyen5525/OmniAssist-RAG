import { NextResponse } from "next/server";
import { z } from "zod";
import { importPageIndex, type ImportPageIndexInput } from "@/lib/server/pageindex-importer";

export const runtime = "nodejs";

const importSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  tags: z.array(z.string()).optional(),
  version: z.string().optional(),
  producer: z.enum(["vectify-pageindex", "internal-md-converter", "unknown"]).optional(),
  producerVersion: z.string().optional(),
  sourceFileUrl: z.string().optional(),
  indexFileUrl: z.string().optional(),
  backupToR2: z.boolean().optional(),
  indexJson: z.any().refine((value) => value !== undefined, "indexJson is required")
});

export async function POST(request: Request) {
  try {
    const input = importSchema.parse(await request.json()) as ImportPageIndexInput;
    const data = await importPageIndex(input);
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ detail: "Validation failed", errors: error.flatten() }, { status: 422 });
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
