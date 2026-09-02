import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/app/generated/prisma/client";
import { resolveDateRange } from "@/lib/utils/date-range";

/**
 * /api/leads — email addresses collected by the campaign email gate.
 *
 * Mirrors /api/logs: workspace-scoped, date-ranged, server-sorted, paginated.
 * The CSV export and the "copy all emails" button both ask for `limit=5000`,
 * which is the hard cap here — a bigger number is clamped, not honoured, and
 * the caller can tell it was truncated by comparing `logs.length` to
 * `pagination.total`.
 */

/** Hard cap — CSV export asks for this; anything larger is clamped. */
const MAX_LIMIT = 5000;
const DEFAULT_LIMIT = 50;
const MAX_SEARCH_LENGTH = 200;

/** Sort allowlist: query value → Prisma orderBy. Anything else → default. */
const SORT_COLUMNS = {
  createdAt: (dir: Prisma.SortOrder) => ({ createdAt: dir }),
  email: (dir: Prisma.SortOrder) => ({ email: dir }),
  username: (dir: Prisma.SortOrder) => ({ username: dir }),
  campaign: (dir: Prisma.SortOrder) => ({ automation: { name: dir } }),
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
    Math.max(
      1,
      Number.parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) ||
        DEFAULT_LIMIT
    )
  );
  const automationId = searchParams.get("automationId");
  // Accept both `search` (this page's param name) and `q` (the logs page's),
  // so a link copied from either place keeps working.
  const q = (searchParams.get("search") ?? searchParams.get("q") ?? "")
    .trim()
    .slice(0, MAX_SEARCH_LENGTH);
  const range = resolveDateRange(searchParams, 30);
  const sort = parseSort(searchParams.get("sort"), searchParams.get("dir"));
  const skip = (page - 1) * limit;

  const where: Prisma.LeadWhereInput = {
    workspaceId,
    createdAt: { gte: range.from, lt: range.toExclusive },
    ...(automationId && automationId !== "all" ? { automationId } : {}),
    ...(q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { username: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  try {
    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: sort.orderBy,
        skip,
        take: limit,
        include: {
          automation: { select: { id: true, name: true } },
          instagramAccount: { select: { username: true } },
        },
      }),
      prisma.lead.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        leads,
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
    const message = error instanceof Error ? error.message : "Failed to load leads";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
