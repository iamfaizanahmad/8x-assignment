import { NextResponse } from "next/server";
import type { TemplateId } from "@/db";
import { getOrCreateSummary } from "@/lib/pipeline";
import { TEMPLATES } from "@/lib/pipeline/templates";

export const maxDuration = 120;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; template: string }> }) {
  const { id, template } = await params;
  if (!(template in TEMPLATES)) return NextResponse.json({ error: "Unknown template" }, { status: 400 });
  try {
    const summary = await getOrCreateSummary(id, template as TemplateId);
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[summary]", err);
    return NextResponse.json({ error: "Could not generate this summary. Try again." }, { status: 500 });
  }
}
