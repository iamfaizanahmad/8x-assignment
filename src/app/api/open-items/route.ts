import { NextResponse } from "next/server";
import { z } from "zod";
import { listOpenItems } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const parsed = z.enum(["pending", "done"]).safeParse(new URL(req.url).searchParams.get("status") ?? "pending");
  if (!parsed.success) return NextResponse.json({ error: "status must be pending or done" }, { status: 400 });
  return NextResponse.json(await listOpenItems(parsed.data));
}
