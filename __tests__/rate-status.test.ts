/**
 * Hiz siniri durumu (lib/ops/rate-status) — panelin salt-okunur goruntusu.
 *
 * Kontrol cifti: dolu sayac "dolu" gorunmeli AMA suresi dolmus sayac "bos"
 * gorunmeli — limiter da ayni sekilde davranir (expiresAt gecmisse 1'den
 * baslatir). Ikincisi olmadan "her sey dolu" da testi gecerdi.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    instagramAccount: { findMany: vi.fn() },
    rateCounter: { findMany: vi.fn() },
    queueJob: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import {
  BURST_MAX,
  HOURLY_MAX,
  hizDurumu,
  isHesabi,
  sayacOku,
} from "../lib/ops/rate-status";

const NOW = new Date("2026-09-02T10:00:00.000Z");
const future = (sec: number) => new Date(NOW.getTime() + sec * 1000);
const past = (sec: number) => new Date(NOW.getTime() - sec * 1000);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("sayacOku (saf)", () => {
  it("sayac yoksa bos pencere", () => {
    expect(sayacOku(undefined, NOW, 8)).toEqual({ used: 0, max: 8, resetsAt: null });
  });

  it("canli sayac: kullanilan + resetsAt", () => {
    const r = sayacOku({ key: "burst:a", count: 5, expiresAt: future(30) }, NOW, 8);
    expect(r).toEqual({ used: 5, max: 8, resetsAt: future(30).toISOString() });
  });

  it("suresi DOLMUS sayac bos sayilir (limiter 1'den baslatir)", () => {
    const r = sayacOku({ key: "burst:a", count: 8, expiresAt: past(1) }, NOW, 8);
    expect(r.used).toBe(0);
    expect(r.resetsAt).toBeNull();
  });

  it("tam simdi dolan sayac da bos (<= sinirinda)", () => {
    const r = sayacOku({ key: "hour:a", count: 700, expiresAt: NOW }, NOW, 750);
    expect(r.used).toBe(0);
  });

  it("max'i asan eski kayit max'a kirpilir, negatif 0'a", () => {
    expect(sayacOku({ key: "k", count: 99, expiresAt: future(9) }, NOW, 8).used).toBe(8);
    expect(sayacOku({ key: "k", count: -3, expiresAt: future(9) }, NOW, 8).used).toBe(0);
  });
});

describe("isHesabi", () => {
  it("is verisinden hesap kimligini cikarir", () => {
    expect(isHesabi({ instagramAccountId: "ig_1", commentId: "c" })).toBe("ig_1");
  });
  it("sekil bilinmiyorsa null", () => {
    expect(isHesabi(null)).toBeNull();
    expect(isHesabi("str")).toBeNull();
    expect(isHesabi({ instagramAccountId: 42 })).toBeNull();
    expect(isHesabi({})).toBeNull();
  });
});

describe("hizDurumu", () => {
  it("hesap basina iki pencere + bekleyen is sayisi", async () => {
    vi.useFakeTimers({ now: NOW });
    mockPrisma.instagramAccount.findMany.mockResolvedValue([
      { id: "ig_1", username: "one" },
      { id: "ig_2", username: "two" },
    ]);
    mockPrisma.rateCounter.findMany.mockResolvedValue([
      { key: "burst:ig_1", count: 8, expiresAt: future(20) }, // dolu, canli
      { key: "hour:ig_1", count: 120, expiresAt: future(1800) },
      { key: "burst:ig_2", count: 8, expiresAt: past(5) }, // dolu ama SURESI DOLMUS
      // hour:ig_2 hic yok
    ]);
    mockPrisma.queueJob.findMany.mockResolvedValue([
      { data: { instagramAccountId: "ig_1" } },
      { data: { instagramAccountId: "ig_1" } },
      { data: { instagramAccountId: "ig_2" } },
      { data: { instagramAccountId: "ig_other" } }, // baska workspace, sayilmaz
      { data: "bozuk" },
    ]);

    const r = await hizDurumu(undefined, "ws_1");

    expect(r).toHaveLength(2);
    const one = r.find((a) => a.accountId === "ig_1")!;
    expect(one.username).toBe("one");
    expect(one.burst).toEqual({ used: 8, max: BURST_MAX, resetsAt: future(20).toISOString() });
    expect(one.hourly.used).toBe(120);
    expect(one.hourly.max).toBe(HOURLY_MAX);
    expect(one.pendingJobs).toBe(2);

    const two = r.find((a) => a.accountId === "ig_2")!;
    expect(two.burst).toEqual({ used: 0, max: BURST_MAX, resetsAt: null });
    expect(two.hourly).toEqual({ used: 0, max: HOURLY_MAX, resetsAt: null });
    expect(two.pendingJobs).toBe(1);

    // Sadece bu hesaplarin anahtarlari sorulmali; PENDING disinda is okunmamali.
    expect(mockPrisma.rateCounter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: { in: ["burst:ig_1", "hour:ig_1", "burst:ig_2", "hour:ig_2"] } },
      })
    );
    expect(mockPrisma.queueJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "PENDING" } })
    );
  });

  it("workspace + tek hesap filtresi sorguya iner", async () => {
    mockPrisma.instagramAccount.findMany.mockResolvedValue([{ id: "ig_9", username: "nine" }]);
    mockPrisma.rateCounter.findMany.mockResolvedValue([]);
    mockPrisma.queueJob.findMany.mockResolvedValue([]);

    await hizDurumu("ig_9", "ws_1");

    expect(mockPrisma.instagramAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: "ws_1", id: "ig_9" } })
    );
  });

  it("hesap yoksa bos dizi, sayac/kuyruk hic sorgulanmaz", async () => {
    mockPrisma.instagramAccount.findMany.mockResolvedValue([]);
    const r = await hizDurumu(undefined, "ws_empty");
    expect(r).toEqual([]);
    expect(mockPrisma.rateCounter.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.queueJob.findMany).not.toHaveBeenCalled();
  });
});
