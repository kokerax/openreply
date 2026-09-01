import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { prisma } from "@/lib/db/client";
import { getDMQueue } from "@/lib/queue/client";
import { getWorkerAlerts, getWorkerHealth } from "@/lib/ops/worker-health";
import type { Prisma, WebhookStatus } from "@/app/generated/prisma/client";

export const runtime = "nodejs";

const WEBHOOK_STATUSES: WebhookStatus[] = ["PENDING", "PROCESSED", "FAILED"];
const DM_FAILURE_STATUSES = [
  "FAILED",
  "SKIPPED_RATE_LIMIT",
  "SKIPPED_PLAN_LIMIT",
  "SKIPPED_NO_MATCH",
] as const;

// GET /api/admin/diagnostics?webhookStatus=ALL|PENDING|PROCESSED|FAILED&ops=all|open|resolved
export async function GET(request: NextRequest): Promise<NextResponse> {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  const workspaceId = ctx.workspaceId;

  const webhookParam = (request.nextUrl.searchParams.get("webhookStatus") ?? "ALL").toUpperCase();
  const webhookStatus = (WEBHOOK_STATUSES as string[]).includes(webhookParam)
    ? (webhookParam as WebhookStatus)
    : null;
  const opsParam = (request.nextUrl.searchParams.get("ops") ?? "all").toLowerCase();
  const opsWhere: Prisma.OperationalEventWhereInput =
    opsParam === "open" ? { resolvedAt: null } : opsParam === "resolved" ? { resolvedAt: { not: null } } : {};

  try {
    const [
      queueCounts,
      workerHealth,
      workerAlerts,
      webhookEvents,
      dmFailures,
      dmFailureGroups,
      tokenRefreshFailures,
      operationalEvents,
    ] = await Promise.all([
      getDMQueue().getJobCounts("waiting", "active", "delayed", "failed"),
      getWorkerHealth(),
      getWorkerAlerts(10),
      // Alansiz (eslesmemis) olaylar da dahil: bir webhook hicbir hesaba
      // baglanamadiysa tam da burada gorunmeli.
      prisma.webhookEvent.findMany({
        where: {
          OR: [{ workspaceId }, { workspaceId: null }],
          ...(webhookStatus ? { status: webhookStatus } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          workspaceId: true,
          object: true,
          status: true,
          errorMessage: true,
          createdAt: true,
          processedAt: true,
        },
      }),
      prisma.dmLog.findMany({
        where: { workspaceId, status: { in: [...DM_FAILURE_STATUSES] } },
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: {
          id: true,
          status: true,
          commentId: true,
          commentText: true,
          errorMessage: true,
          updatedAt: true,
          automation: { select: { name: true } },
        },
      }),
      prisma.dmLog.groupBy({
        by: ["errorMessage"],
        where: { workspaceId, status: { in: [...DM_FAILURE_STATUSES] } },
        _count: { _all: true },
        _max: { updatedAt: true },
        orderBy: { _count: { errorMessage: "desc" } },
        take: 10,
      }),
      prisma.operationalEvent.findMany({
        where: { workspaceId, source: "TOKEN_REFRESH", level: "ERROR" },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, message: true, createdAt: true, payload: true },
      }),
      prisma.operationalEvent.findMany({
        where: { OR: [{ workspaceId }, { workspaceId: null }], ...opsWhere },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          source: true,
          level: true,
          message: true,
          payload: true,
          createdAt: true,
          resolvedAt: true,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        queueCounts,
        workerHealth,
        workerAlerts,
        webhookEvents,
        dmFailures,
        dmFailureGroups: dmFailureGroups.map((g) => ({
          errorMessage: g.errorMessage,
          count: g._count._all,
          lastSeen: g._max.updatedAt,
        })),
        tokenRefreshFailures,
        operationalEvents,
        filters: { webhookStatus: webhookStatus ?? "ALL", ops: opsParam },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Diagnostics could not be loaded.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
