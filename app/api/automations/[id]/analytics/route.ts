import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { dayKeys, resolveDateRange } from "@/lib/utils/date-range";
import { buildCampaignAnalytics } from "./compute";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD (default: last 30 days). */
export async function GET(request: NextRequest, { params }: RouteProps) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { id } = await params;
  const automation = await prisma.automation.findFirst({
    where: { id, workspaceId },
    select: { id: true },
  });
  if (!automation) {
    return NextResponse.json(
      { success: false, error: "Campaign not found" },
      { status: 404 }
    );
  }

  const range = resolveDateRange(request.nextUrl.searchParams, 30);
  const createdAt = { gte: range.from, lt: range.toExclusive };
  // Migration seal rows (isBackfill) were never sent by this system and must
  // not count as comments, sends, or failures.
  const dmScope = { workspaceId, automationId: id, isBackfill: false, createdAt };

  const [comments, sentRows, clickRows, failedRows] = await Promise.all([
    prisma.dmLog.count({ where: dmScope }),
    prisma.dmLog.findMany({
      where: { ...dmScope, status: "SENT" },
      select: { createdAt: true },
    }),
    prisma.linkClick.findMany({
      where: { workspaceId, automationId: id, createdAt },
      select: { createdAt: true, referrer: true, userAgent: true },
    }),
    prisma.dmLog.findMany({
      where: { ...dmScope, status: "FAILED" },
      select: { errorMessage: true },
    }),
  ]);

  const data = buildCampaignAnalytics({
    dayKeys: dayKeys(range),
    comments,
    sentAt: sentRows.map((r) => r.createdAt),
    clicks: clickRows,
    failures: failedRows.map((r) => r.errorMessage),
  });

  return NextResponse.json(
    {
      success: true,
      data: { range: { from: range.fromKey, to: range.toKey }, ...data },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
