import { NextResponse } from "next/server";
import {
  buildHelpdeskSyncSnapshot,
  HelpdeskSyncError
} from "@/lib/server/helpdesk-sync";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const snapshot = await buildHelpdeskSyncSnapshot(slug);
    return NextResponse.json(
      { data: snapshot },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof HelpdeskSyncError) {
      return NextResponse.json(
        { detail: error.message },
        { status: error.statusCode }
      );
    }
    const message =
      error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
