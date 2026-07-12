import { NextResponse } from "next/server";
import { z } from "zod";
import { setMessageFeedback } from "@/lib/server/repository";

export const runtime = "nodejs";

const feedbackSchema = z.object({
  feedback: z.enum(["up", "down"]).nullable()
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const input = feedbackSchema.parse(await request.json());
    const updated = await setMessageFeedback(params.id, input.feedback);
    if (!updated) {
      return NextResponse.json({ detail: "Message not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ detail: "Validation failed", errors: error.flatten() }, { status: 422 });
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
