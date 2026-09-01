/**
 * getFollowerHistory — the chart needs to know which points were observed and
 * which were reconstructed, so the `backfilled` flag must survive the read.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    followerSnapshot: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/client", () => ({
  getFollowerCountSeries: vi.fn(),
  getUserInfo: vi.fn(),
}));

import { getFollowerHistory } from "../lib/reports/follower-history";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getFollowerHistory", () => {
  it("returns points with deltas and the backfilled flag", async () => {
    mockPrisma.followerSnapshot.findMany.mockResolvedValue([
      { date: new Date("2026-08-30T00:00:00Z"), followersCount: 100, backfilled: true },
      { date: new Date("2026-08-31T00:00:00Z"), followersCount: 104, backfilled: true },
      { date: new Date("2026-09-01T00:00:00Z"), followersCount: 110, backfilled: false },
    ]);

    const history = await getFollowerHistory("acc_1", 30);

    expect(history).toEqual([
      { date: "2026-08-30", followers: 100, delta: null, backfilled: true },
      { date: "2026-08-31", followers: 104, delta: 4, backfilled: true },
      { date: "2026-09-01", followers: 110, delta: 6, backfilled: false },
    ]);
  });

  it("asks the database for the backfilled column", async () => {
    mockPrisma.followerSnapshot.findMany.mockResolvedValue([]);

    await getFollowerHistory("acc_1", 7);

    expect(mockPrisma.followerSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ instagramAccountId: "acc_1" }),
        select: expect.objectContaining({ backfilled: true }),
      })
    );
  });
});
