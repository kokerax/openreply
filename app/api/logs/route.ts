import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { DmStatus, type Prisma } from "@/app/generated/prisma/client";
import { resolveDateRange } from "@/lib/utils/date-range";

/** Hard cap — CSV export asks for this; anything larger is clamped. */
const MAX_LIMIT = 5000;
const DEFAULT_LIMIT = 20;
const MAX_SEARCH_LENGTH = 200;

/** Sort allowlist: query value → Prisma orderBy. Anything else → default. */
const SORT_COLUMNS = {
  createdAt: (dir: Prisma.SortOrder) => ({ createdAt: dir }),
  status: (dir: Prisma.SortOrder) => ({ status: dir }),
  campaign: (dir: Prisma.SortOrder) => ({ automation: { name: dir } }),
  account: (dir: Prisma.SortOrder) => ({ instagramAccount: { username: dir } }),
} as const;
type SortKey = keyof typeof SORT_COLUMNS;

function parseSort(sort: string | null, dir: string | null) {
  const key: SortKey = sort && sort in SORT_COLUMNS ? (sort as SortKey) : "createdAt";
  const order: Prisma.SortOrder = dir === "asc" ? "asc" : "desc";
  return { key, order, orderBy: SORT_COLUMNS[key](order) };
}

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  );
  const status = searchParams.get("status");
  const instagramAccountId = searchParams.get("instagramAccountId");
  const q = (searchParams.get("q") ?? "").trim().slice(0, MAX_SEARCH_LENGTH);
  const range = resolveDateRange(searchParams, 30);
  const sort = parseSort(searchParams.get("sort"), searchParams.get("dir"));
  const skip = (page - 1) * limit;
  const parsedStatus =
    status && Object.values(DmStatus).includes(status as DmStatus)
      ? (status as DmStatus)
      : null;

  const where: Prisma.DmLogWhereInput = {
    workspaceId,
    createdAt: { gte: range.from, lt: range.toExclusive },
    ...(parsedStatus ? { status: parsedStatus } : {}),
    ...(instagramAccountId && instagramAccountId !== "all"
      ? { instagramAccountId }
      : {}),
    ...(q
      ? {
          OR: [
            { commenterName: { contains: q, mode: "insensitive" } },
            { commentText: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  try {
    const [logs, total] = await Promise.all([
      prisma.dmLog.findMany({
        where,
        orderBy: sort.orderBy,
        skip,
        take: limit,
        include: {
          automation: { select: { name: true, keywords: true } },
          instagramAccount: { select: { username: true } },
        },
      }),
      prisma.dmLog.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        logs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
        range: { from: range.fromKey, to: range.toKey, days: range.days },
        sort: { col: sort.key, dir: sort.order },
        q,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load logs";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
