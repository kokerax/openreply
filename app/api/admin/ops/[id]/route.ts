import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const runtime = "nodejs";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/ops/[id] → resolvedAt = now.
 *
 * Kapsam, diagnostics zaman cizelgesiyle ayni: alanin kendi olaylari VE
 * alansiz (workspaceId null) sistem olaylari. Zaten cozulmus olay yeniden
 * damgalanmaz (idempotent), bulunamayan 404.
 */
export async function POST(_request: NextRequest, { params }: RouteProps): Promise<NextResponse> {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageWorkspace(ctx.role)) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const olay = await prisma.operationalEvent.findFirst({
      where: { id, OR: [{ workspaceId: ctx.workspaceId }, { workspaceId: null }] },
      select: { id: true, resolvedAt: true },
    });
    if (!olay) {
      return NextResponse.json({ success: false, error: "Event not found." }, { status: 404 });
    }
    if (olay.resolvedAt) {
      return NextResponse.json({ success: true, data: { id, resolvedAt: olay.resolvedAt } });
    }
    const resolvedAt = new Date();
    await prisma.operationalEvent.update({ where: { id }, data: { resolvedAt } });
    return NextResponse.json({ success: true, data: { id, resolvedAt } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Resolve failed.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
