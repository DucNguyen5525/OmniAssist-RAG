import { NextResponse } from "next/server";
import { getAvailableModels } from "@/lib/server/gemini";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ data: getAvailableModels() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
