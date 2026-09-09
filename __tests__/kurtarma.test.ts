/**
 * Blok sonrasi kurtarma testleri.
 *
 * Her kural iki yonlu sinaniyor: kurtarilmasi GEREKEN kayit kuyruklanmali VE
 * kurtarilmamasi gereken kayit kuyruklanmamali. Tek yonlu ("bir sey kuyruklandi")
 * bir assert, filtrenin calistigini kanitlamaz.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockQueueAdd } = vi.hoisted(() => ({
  mockPrisma: { dmLog: { findMany: vi.fn(), update: vi.fn() } },
  mockQueueAdd: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: mockQueueAdd }),
}));

import { bloktanKurtar, SWEEP_TAVANI } from "@/lib/ops/kurtarma";

function kayit(over: Record<string, unknown> = {}) {
  return {
    id: "log1",
    commentId: "c1",
    commentText: "City",
    commenterId: "u1",
    commenterName: "ulaskonu16",
    attempts: 1,
    createdAt: new Date(Date.now() - 3600_000),
    automation: {
      id: "a1",
      name: "CITY Şehir Promptu",
      isActive: true,
      postId: null,
    },
    instagramAccount: { instagramId: "17841465942418709" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.dmLog.update.mockResolvedValue({});
  mockQueueAdd.mockResolvedValue({ id: "job1" });
});

describe("bloktanKurtar", () => {
  it("gecici blok yuzunden dusmus kaydi yeniden kuyruklar", async () => {
    mockPrisma.dmLog.findMany.mockResolvedValue([kayit()]);

    const sonuc = await bloktanKurtar();

    expect(sonuc.kuyruklanan).toBe(1);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "process-comment",
      expect.objectContaining({
        commentId: "c1",
        commenterName: "ulaskonu16",
        source: "KURTARMA",
      }),
      expect.objectContaining({ jobId: "kurtarma:log1:2" })
    );
  });

  it("duraklatilmis kampanyanin kaydini DIRILTMEZ", async () => {
    mockPrisma.dmLog.findMany.mockResolvedValue([
      kayit({ automation: { id: "a1", name: "Kapali", isActive: false, postId: null } }),
    ]);

    const sonuc = await bloktanKurtar();

    // Kullanici kampanyayi bilerek kapatmis olabilir; kurtarma onu ezmemeli.
    expect(sonuc.kuyruklanan).toBe(0);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("sorguyu yalnizca GECICI hatalar + acik pencere + deneme siniri ile kurar", async () => {
    mockPrisma.dmLog.findMany.mockResolvedValue([]);

    await bloktanKurtar();

    const arg = mockPrisma.dmLog.findMany.mock.calls[0][0];
    expect(arg.where.status).toBe("FAILED");
    expect(arg.where.isBackfill).toBe(false);
    // Kalici redler disarida kalsin diye hata imzasi filtresi ZORUNLU.
    const imzalar = arg.where.OR.map(
      (o: { errorMessage: { contains: string } }) => o.errorMessage.contains
    );
    expect(imzalar).toContain("sub=2534025");
    expect(imzalar).toContain("code=368");
    // Kalici bir red imzasi asla listeye girmemeli.
    expect(imzalar).not.toContain("requested user cannot be found");
    expect(imzalar).not.toContain("outside of allowed window");
    // Sonsuz donguyu kesen sayac siniri.
    expect(arg.where.attempts.lt).toBeGreaterThan(0);
    // 7 gunluk private-reply penceresinden once kesilmeli.
    const yasSiniriGun =
      (Date.now() - arg.where.createdAt.gte.getTime()) / 86400_000;
    expect(yasSiniriGun).toBeLessThan(7);
    expect(yasSiniriGun).toBeGreaterThan(1);
  });

  it("SENTETIK defter satirlarini kurtarmaya ALMAZ", async () => {
    // `reveal:`/`emailgate:` satirlari da blok sirasinda code=368 ile FAILED
    // yaziliyor ve bu WHERE'e giriyordu; yeniden denemek asla calisamayacak
    // bir cagriya kota + hiz slotu harciyor ve asil hatayi eziyor.
    mockPrisma.dmLog.findMany.mockResolvedValue([]);

    await bloktanKurtar();

    const w = mockPrisma.dmLog.findMany.mock.calls[0][0].where;
    expect(w.commentId).toEqual({ not: { contains: ":" } });
  });

  it("sayaci kuyruklamadan ONCE artirir (blok surerse dongu kesilsin)", async () => {
    mockPrisma.dmLog.findMany.mockResolvedValue([kayit()]);
    const sira: string[] = [];
    mockPrisma.dmLog.update.mockImplementation(async () => {
      sira.push("sayac");
      return {};
    });
    mockQueueAdd.mockImplementation(async () => {
      sira.push("kuyruk");
      return { id: "job1" };
    });

    await bloktanKurtar();

    expect(sira).toEqual(["sayac", "kuyruk"]);
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith({
      where: { id: "log1" },
      data: { attempts: { increment: 1 } },
    });
  });

  it("tavani asmaz — birikmis yigin tek seferde bosalmasin", async () => {
    mockPrisma.dmLog.findMany.mockResolvedValue([]);

    await bloktanKurtar();

    expect(mockPrisma.dmLog.findMany.mock.calls[0][0].take).toBe(SWEEP_TAVANI);
    expect(SWEEP_TAVANI).toBeLessThanOrEqual(20);
  });

  it("kuru deneme hicbir sey yazmaz", async () => {
    mockPrisma.dmLog.findMany.mockResolvedValue([kayit()]);

    const sonuc = await bloktanKurtar(10, true);

    expect(sonuc.aday).toBe(1);
    expect(sonuc.kuyruklanan).toBe(0);
    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.update).not.toHaveBeenCalled();
  });

  it("gonderiye bagli kampanyada mediaId olarak postId'yi tasir", async () => {
    mockPrisma.dmLog.findMany.mockResolvedValue([
      kayit({
        automation: { id: "a1", name: "Bagli", isActive: true, postId: "media_9" },
      }),
    ]);

    await bloktanKurtar();

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "process-comment",
      expect.objectContaining({ mediaId: "media_9" }),
      expect.anything()
    );
  });
});
