/**
 * /api/logs — arama, siralama allowlist'i, tarih araligi, 5000 tavani.
 *
 * Siralama allowlist'i icin iki yon: izinli sutun ilgili orderBy'a cevrilir
 * VE izinsiz sutun (`sort=evil`) sessizce varsayilana duser — kullanici
 * girdisi hicbir zaman Prisma'ya oldugu gibi gitmez.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockWorkspaceId } = vi.hoisted(() => ({
  mockPrisma: {
    dmLog: { findMany: vi.fn(), count: vi.fn() },
  },
  mockWorkspaceId: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId: mockWorkspaceId }));

import { NextRequest } from "next/server";
import { GET } from "../app/api/logs/route";

function req(query = "") {
  return new NextRequest(`http://localhost/api/logs${query}`);
}

function lastFindManyArgs() {
  const calls = mockPrisma.dmLog.findMany.mock.calls;
  return calls[calls.length - 1][0] as {
    where: Record<string, unknown>;
    orderBy: unknown;
    skip: number;
    take: number;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWorkspaceId.mockResolvedValue("ws_1");
  mockPrisma.dmLog.findMany.mockResolvedValue([]);
  mockPrisma.dmLog.count.mockResolvedValue(0);
});

describe("GET /api/logs", () => {
  it("401 without a workspace", async () => {
    mockWorkspaceId.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockPrisma.dmLog.findMany).not.toHaveBeenCalled();
  });

  it("defaults: 30-day range, createdAt desc, page 1 × 20", async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    const args = lastFindManyArgs();
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(args.skip).toBe(0);
    expect(args.take).toBe(20);
    expect(args.where.workspaceId).toBe("ws_1");
    expect(args.where.createdAt).toBeDefined();
    expect(body.data.range.days).toBe(30);
    expect(body.data.sort).toEqual({ col: "createdAt", dir: "desc" });
    expect(body.data.pagination.totalPages).toBe(1);
  });

  it("applies from/to as gte/lt", async () => {
    await GET(req("?from=2026-08-01&to=2026-08-03"));
    expect(lastFindManyArgs().where.createdAt).toEqual({
      gte: new Date("2026-08-01T00:00:00.000Z"),
      lt: new Date("2026-08-04T00:00:00.000Z"),
    });
  });

  it("search: case-insensitive contains on commenterName OR commentText", async () => {
    await GET(req("?q=%20Ayşe%20"));
    expect(lastFindManyArgs().where.OR).toEqual([
      { commenterName: { contains: "Ayşe", mode: "insensitive" } },
      { commentText: { contains: "Ayşe", mode: "insensitive" } },
    ]);
    // count must see the same filter or pagination lies
    expect(mockPrisma.dmLog.count).toHaveBeenCalledWith({ where: lastFindManyArgs().where });
  });

  it("no search → no OR clause", async () => {
    await GET(req("?q=%20%20"));
    expect(lastFindManyArgs().where.OR).toBeUndefined();
  });

  it("sort allowlist: relation columns map to nested orderBy", async () => {
    await GET(req("?sort=campaign&dir=asc"));
    expect(lastFindManyArgs().orderBy).toEqual({ automation: { name: "asc" } });

    await GET(req("?sort=account&dir=desc"));
    expect(lastFindManyArgs().orderBy).toEqual({ instagramAccount: { username: "desc" } });

    await GET(req("?sort=status&dir=asc"));
    expect(lastFindManyArgs().orderBy).toEqual({ status: "asc" });
  });

  it("sort allowlist: unknown column and unknown dir fall back to default", async () => {
    const res = await GET(req("?sort=evil&dir=sideways"));
    const body = await res.json();
    expect(lastFindManyArgs().orderBy).toEqual({ createdAt: "desc" });
    expect(body.data.sort).toEqual({ col: "createdAt", dir: "desc" });
  });

  it("caps limit at 5000 and floors at 1; bad numbers fall back", async () => {
    await GET(req("?limit=999999"));
    expect(lastFindManyArgs().take).toBe(5000);

    await GET(req("?limit=-5"));
    expect(lastFindManyArgs().take).toBe(1);

    // 0 is not a usable page size → default, not a zero-row query.
    await GET(req("?limit=0"));
    expect(lastFindManyArgs().take).toBe(20);

    await GET(req("?limit=abc&page=xyz"));
    expect(lastFindManyArgs().take).toBe(20);
    expect(lastFindManyArgs().skip).toBe(0);
  });

  it("pagination: page 3 × 20 skips 40", async () => {
    mockPrisma.dmLog.count.mockResolvedValue(95);
    const res = await GET(req("?page=3"));
    const body = await res.json();
    expect(lastFindManyArgs().skip).toBe(40);
    expect(body.data.pagination).toEqual({ page: 3, limit: 20, total: 95, totalPages: 5 });
  });

  it("status: valid enum filters, invalid is ignored; account filter passes through", async () => {
    await GET(req("?status=FAILED&instagramAccountId=ig_2"));
    expect(lastFindManyArgs().where.status).toBe("FAILED");
    expect(lastFindManyArgs().where.instagramAccountId).toBe("ig_2");

    await GET(req("?status=NOT_A_STATUS&instagramAccountId=all"));
    expect(lastFindManyArgs().where.status).toBeUndefined();
    expect(lastFindManyArgs().where.instagramAccountId).toBeUndefined();
  });

  it("500 with message when the DB throws", async () => {
    mockPrisma.dmLog.findMany.mockRejectedValue(new Error("boom"));
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "boom" });
  });
});
