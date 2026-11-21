import { NextResponse } from "next/server";
import { isLocalRequest } from "@/lib/local-request";
import { loadReviewProject } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  if (!isLocalRequest(request)) return NextResponse.json({ error: "Local access only." }, { status: 403 });
  const { projectId } = await params;
  const loaded = await loadReviewProject(projectId);
  if (!loaded) return NextResponse.json({ error: "Выгрузка не найдена или повреждена." }, { status: 404 });
  return NextResponse.json(loaded);
}
