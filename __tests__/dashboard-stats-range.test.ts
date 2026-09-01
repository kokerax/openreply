/**
 * /api/dashboard/stats — tarih araligi + sifir-dolgulu gunluk seri.
 *
 * Iki sey korunmali: (1) `isBackfill: false` HER dmLog sorgusunda kalmali
 * (348 sahte gonderim vakasi), (2) `dailyDMs` araligin TAMAMINI kapsamali,
 * kaydi olmayan gunler 0 ile dolmali.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockWorkspaceId, mockUserId } = vi.hoisted(() => ({
  mockPrisma: {
    workspace: { findUnique: vi.fn() },
    instagramAccount: { findFirst: vi.fn(), findMany: vi.fn() },
    automation: { count: vi.fn() },
    dmLog: { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    linkClick: { count: vi.fn() },
    user: { findUnique: vi.fn() },
  },
  mockWorkspaceId: vi.fn(),
  mockUserId: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({
  getCurrentWorkspaceId: mockWorkspaceId,
  getCurrentUserId: mockUserId,
}));

import { NextRequest } from "next/server";
import { GET } from "../app/api/dashboard/stats/route";

function req(query = "") {
  return new NextRequest(`http://localhost/api/dashboard/stats${query}`);
}

function primeHappyPath(sentRows: { createdAt: Date }[] = []) {
  mockWorkspaceId.mockResolvedValue("ws_1");
  mockUserId.mockResolvedValue("user_1");
  mockPrisma.workspace.findUnique.mockResolvedValue({ name: "WS", dmsSentThisPeriod: 0 });
  mockPrisma.instagramAccount.findFirst.mockResolvedValue(null);
  mockPrisma.instagramAccount.findMany.mockResolvedValue([]);
  mockPrisma.automation.count.mockResolvedValue(3);
  mockPrisma.dmLog.count.mockResolvedValue(7);
  mockPrisma.dmLog.groupBy.mockResolvedValue([]);
  mockPrisma.linkClick.count.mockResolvedValue(2);
  mockPrisma.user.findUnique.mockResolvedValue({ name: "Ali Koker", email: "a@b.c" });
  // findMany is used three times: recentLogs, contacts (distinct), sent series.
  mockPrisma.dmLog.findMany.mockImplementation(async (args: { select?: { createdAt?: boolean } }) => {
    if (args.select?.createdAt) return sentRows;
    return [];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/dashboard/stats", () => {
  it("401 without a workspace", async () => {
    mockWorkspaceId.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockPrisma.dmLog.count).not.toHaveBeenCalled();
  });

  it("zero-fills dailyDMs over the whole from..to range (UTC days)", async () => {
    primeHappyPath([
      { createdAt: new Date("2026-08-02T05:00:00.000Z") },
      { createdAt: new Date("2026-08-02T23:59:00.000Z") },
      { createdAt: new Date("2026-08-04T12:00:00.000Z") },
      // Outside the range — the DB filter would drop it; make sure JS does too.
      { createdAt: new Date("2026-08-09T12:00:00.000Z") },
    ]);

    const res = await GET(req("?from=2026-08-01&to=2026-08-05"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.range).toEqual({ from: "2026-08-01", to: "2026-08-05", days: 5 });
    expect(body.data.dailyDMs).toEqual([
      { date: "2026-08-01", count: 0 },
      { date: "2026-08-02", count: 2 },
      { date: "2026-08-03", count: 0 },
      { date: "2026-08-04", count: 1 },
      { date: "2026-08-05", count: 0 },
    ]);
    expect(body.data.userName).toBe("Ali");
  });

  it("range-scoped queries use gte from / lt toExclusive, and never drop isBackfill:false", async () => {
    primeHappyPath();
    await GET(req("?from=2026-08-01&to=2026-08-05"));

    const from = new Date("2026-08-01T00:00:00.000Z");
    const toExclusive = new Date("2026-08-06T00:00:00.000Z");

    // Every dmLog query (count/groupBy/findMany) must carry the backfill guard.
    const dmLogWheres = [
      ...mockPrisma.dmLog.count.mock.calls,
      ...mockPrisma.dmLog.groupBy.mock.calls,
      ...mockPrisma.dmLog.findMany.mock.calls,
    ].map((c) => (c[0] as { where: Record<string, unknown> }).where);
    expect(dmLogWheres.length).toBeGreaterThanOrEqual(7);
    for (const where of dmLogWheres) {
      expect(where.isBackfill).toBe(false);
    }

    // At least the "sent in range" count and the status groupBy carry the range.
    const ranged = dmLogWheres.filter(
      (w) =>
        w.createdAt &&
        (w.createdAt as { gte?: Date }).gte?.getTime() === from.getTime() &&
        (w.createdAt as { lt?: Date }).lt?.getTime() === toExclusive.getTime()
    );
    expect(ranged.length).toBeGreaterThanOrEqual(3); // sent count, groupBy, series
    expect(mockPrisma.linkClick.count).toHaveBeenCalledWith({
      where: { workspaceId: "ws_1", createdAt: { gte: from, lt: toExclusive } },
    });
  });

  it("defaults to 30 days when no range is given", async () => {
    primeHappyPath();
    const res = await GET(req());
    const body = await res.json();
    expect(body.data.range.days).toBe(30);
    expect(body.data.dailyDMs).toHaveLength(30);
  });

  it("forwards the account filter and echoes it back", async () => {
    primeHappyPath();
    const res = await GET(req("?instagramAccountId=ig_7"));
    const body = await res.json();
    expect(body.data.selectedInstagramAccountId).toBe("ig_7");
    for (const call of mockPrisma.dmLog.count.mock.calls) {
      expect((call[0] as { where: { instagramAccountId?: string } }).where.instagramAccountId).toBe("ig_7");
    }
  });

  it("500 with the error message when the DB throws (no zeros-as-data)", async () => {
    primeHappyPath();
    mockPrisma.dmLog.count.mockRejectedValue(new Error("db down"));
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: "db down" });
  });
});
