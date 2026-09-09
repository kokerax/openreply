import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { gonderiPerformansi } from "@/lib/ops/gonderi-performansi";
import { resolveDateRange } from "@/lib/utils/date-range";

export const runtime = "nodejs";

/**
 * GET /api/admin/top-posts?from=&to=&instagramAccountId=
 *
 * Dashboard'in ana istegine EKLENMEDI: her satir icin bir Graph API cagrisi
 * yapiyor ve ana ekranin ilk yuklenmesini yavaslatirdi. Panel bunu ayri
 * yukluyor (RateLimitWidget'taki desenin aynisi).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const range = resolveDateRange(request.nextUrl.searchParams, 30);
  const hesapId = request.nextUrl.searchParams.get("instagramAccountId");

  const data = await gonderiPerformansi(
    ctx.workspaceId,
    range.from,
    range.toExclusive,
    hesapId && hesapId !== "all" ? hesapId : undefined
  );

  return NextResponse.json({
    success: true,
    data: { ...data, range: { from: range.fromKey, to: range.toKey } },
  });
}
