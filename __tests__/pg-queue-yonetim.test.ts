/**
 * pg-queue yonetim yardimcilari (panel: /api/admin/queue).
 * Prisma mock'lanir; SQL degil, gonderilen where/data sekli dogrulanir.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    queueJob: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import {
  BITMEMIS_DURUMLAR,
  TAKILMA_ESIGI_DK,
  basarisizlariYenidenKuyrukla,
  eskiTamamlananlariSil,
  isCalismaAlaninaAitMi,
  isiGetir,
  isiSil,
  isiYenidenKuyrukla,
  isinHesabi,
  isleriListele,
  takilanIsSayisi,
} from "@/lib/queue/pg-queue";

const SIMDI = new Date("2026-09-02T10:00:00.000Z");
const HESAPLAR = ["acc_a", "acc_b"];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isinHesabi / isCalismaAlaninaAitMi", () => {
  it("reads instagramAccountId from job data", () => {
    expect(isinHesabi({ instagramAccountId: "acc_a", commentId: "c1" })).toBe("acc_a");
  });

  it("returns null for missing, empty, non-string or non-object data", () => {
    expect(isinHesabi({})).toBeNull();
    expect(isinHesabi({ instagramAccountId: "" })).toBeNull();
    expect(isinHesabi({ instagramAccountId: 42 })).toBeNull();
    expect(isinHesabi(null)).toBeNull();
    expect(isinHesabi("acc_a")).toBeNull();
  });

  it("matches only when the account is in the workspace list (both directions)", () => {
    expect(isCalismaAlaninaAitMi({ instagramAccountId: "acc_a" }, HESAPLAR)).toBe(true);
    expect(isCalismaAlaninaAitMi({ instagramAccountId: "acc_zzz" }, HESAPLAR)).toBe(false);
  });

  it("never treats an account-less job as owned (no leak)", () => {
    expect(isCalismaAlaninaAitMi({ commentId: "c1" }, HESAPLAR)).toBe(false);
    expect(isCalismaAlaninaAitMi({ instagramAccountId: "acc_a" }, [])).toBe(false);
  });
});

describe("isleriListele", () => {
  it("returns [] without querying when the workspace has no accounts", async () => {
    const sonuc = await isleriListele({ hesapIdleri: [] });
    expect(sonuc).toEqual([]);
    expect(mockPrisma.queueJob.findMany).not.toHaveBeenCalled();
  });

  it("defaults to non-DONE statuses and scopes by account via JSON path", async () => {
    mockPrisma.queueJob.findMany.mockResolvedValue([{ id: "j1" }]);
    const sonuc = await isleriListele({ hesapIdleri: HESAPLAR });
    expect(sonuc).toEqual([{ id: "j1" }]);
    const arg = mockPrisma.queueJob.findMany.mock.calls[0][0];
    expect(arg.where.status).toEqual({ in: BITMEMIS_DURUMLAR });
    expect(BITMEMIS_DURUMLAR).not.toContain("DONE");
    expect(arg.where.OR).toEqual([
      { data: { path: ["instagramAccountId"], equals: "acc_a" } },
      { data: { path: ["instagramAccountId"], equals: "acc_b" } },
    ]);
    expect(arg.select.data).toBe(true);
  });

  it("honours an explicit status list and clamps the limit to 500", async () => {
    mockPrisma.queueJob.findMany.mockResolvedValue([]);
    await isleriListele({ hesapIdleri: HESAPLAR, durumlar: ["DONE"], limit: 9999 });
    const arg = mockPrisma.queueJob.findMany.mock.calls[0][0];
    expect(arg.where.status).toEqual({ in: ["DONE"] });
    expect(arg.take).toBe(500);
  });
});

describe("isiGetir", () => {
  it("returns null when the job does not exist", async () => {
    mockPrisma.queueJob.findUnique.mockResolvedValue(null);
    expect(await isiGetir("nope")).toBeNull();
    expect(mockPrisma.queueJob.findUnique.mock.calls[0][0].where).toEqual({ id: "nope" });
  });
});

describe("isiYenidenKuyrukla (retry)", () => {
  it("resets to PENDING, runAt=now, attempts=0, unlocked, not completed", async () => {
    mockPrisma.queueJob.update.mockResolvedValue({});
    await isiYenidenKuyrukla("j1", SIMDI);
    expect(mockPrisma.queueJob.update).toHaveBeenCalledWith({
      where: { id: "j1" },
      data: { status: "PENDING", runAt: SIMDI, attempts: 0, lockedAt: null, completedAt: null },
    });
  });
});

describe("isiSil (purge)", () => {
  it("deletes exactly that id", async () => {
    mockPrisma.queueJob.delete.mockResolvedValue({});
    await isiSil("j1");
    expect(mockPrisma.queueJob.delete).toHaveBeenCalledWith({ where: { id: "j1" } });
  });
});

describe("basarisizlariYenidenKuyrukla (retry all FAILED)", () => {
  it("returns 0 and does nothing without accounts", async () => {
    expect(await basarisizlariYenidenKuyrukla([], SIMDI)).toBe(0);
    expect(mockPrisma.queueJob.updateMany).not.toHaveBeenCalled();
  });

  it("only touches FAILED jobs of the given accounts and returns the count", async () => {
    mockPrisma.queueJob.updateMany.mockResolvedValue({ count: 3 });
    expect(await basarisizlariYenidenKuyrukla(HESAPLAR, SIMDI)).toBe(3);
    const arg = mockPrisma.queueJob.updateMany.mock.calls[0][0];
    expect(arg.where.status).toBe("FAILED");
    expect(arg.where.OR).toHaveLength(2);
    expect(arg.data).toEqual({ status: "PENDING", runAt: SIMDI, attempts: 0, lockedAt: null, completedAt: null });
  });
});

describe("eskiTamamlananlariSil (purge DONE older than N days)", () => {
  it("returns 0 and does nothing without accounts", async () => {
    expect(await eskiTamamlananlariSil([], 7, SIMDI)).toBe(0);
    expect(mockPrisma.queueJob.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes DONE jobs completed before now - 7 days (app time, not NOW())", async () => {
    mockPrisma.queueJob.deleteMany.mockResolvedValue({ count: 12 });
    expect(await eskiTamamlananlariSil(HESAPLAR, 7, SIMDI)).toBe(12);
    const arg = mockPrisma.queueJob.deleteMany.mock.calls[0][0];
    expect(arg.where.status).toBe("DONE");
    expect(arg.where.completedAt).toEqual({ lt: new Date("2026-08-26T10:00:00.000Z") });
    expect(arg.where.OR).toHaveLength(2);
  });
});

describe("takilanIsSayisi (stuck count)", () => {
  it("uses the same 10-minute threshold as isleriKilitle's default", () => {
    expect(TAKILMA_ESIGI_DK).toBe(10);
  });

  it("counts ACTIVE jobs locked before now - threshold", async () => {
    mockPrisma.queueJob.count.mockResolvedValue(2);
    expect(await takilanIsSayisi(HESAPLAR, SIMDI)).toBe(2);
    const arg = mockPrisma.queueJob.count.mock.calls[0][0];
    expect(arg.where.status).toBe("ACTIVE");
    expect(arg.where.lockedAt).toEqual({ lt: new Date("2026-09-02T09:50:00.000Z") });
  });

  it("returns 0 without accounts", async () => {
    expect(await takilanIsSayisi([], SIMDI)).toBe(0);
    expect(mockPrisma.queueJob.count).not.toHaveBeenCalled();
  });
});
