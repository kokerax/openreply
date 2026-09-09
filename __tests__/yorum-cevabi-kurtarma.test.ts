/**
 * Eksik yorum cevabi tamamlama testleri — her kural iki yonlu sinaniyor.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockQueueAdd } = vi.hoisted(() => ({
  mockPrisma: {
    dmLog: { findMany: vi.fn() },
    queueJob: { findMany: vi.fn() },
  },
  mockQueueAdd: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: mockQueueAdd }),
}));

import {
  eksikYorumCevaplariniTamamla,
  YORUM_TUR_TAVANI,
} from "@/lib/ops/yorum-cevabi-kurtarma";

function kayit(over: Record<string, unknown> = {}) {
  return {
    id: "log1",
    commentId: "c1",
    commentText: "City",
    commenterId: "u1",
    commenterName: "ulaskonu16",
    createdAt: new Date(Date.now() - 3600_000),
    automation: {
      name: "CITY Şehir Promptu",
      postId: null,
      publicReplyMessages: ["DM'den yolladım 🏙️", "Gönderdim! DM kutuna bak 👀"],
    },
    instagramAccount: { instagramId: "17841465942418709" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQueueAdd.mockResolvedValue({ id: "job1" });
  // Varsayilan: bugun hicbir kayit denenmemis.
  mockPrisma.queueJob.findMany.mockResolvedValue([]);
});

describe("eksikYorumCevaplariniTamamla", () => {
  it("cevabi eksik kaydi yeniden kuyruklar", async () => {
    mockPrisma.dmLog.findMany.mockResolvedValue([kayit()]);

    const sonuc = await eksikYorumCevaplariniTamamla();

    expect(sonuc.kuyruklanan).toBe(1);
    expect(sonuc.kampanyalar["CITY Şehir Promptu"]).toBe(1);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "process-comment",
      expect.objectContaining({ commentId: "c1" }),
      expect.objectContaining({
        jobId: expect.stringContaining("yorumcevabi:log1:"),
      })
    );
  });

  it("metni OLMAYAN kampanyayi kuyruklamaz (bosuna tur harcamasin)", async () => {
    mockPrisma.dmLog.findMany.mockResolvedValue([
      kayit({
        automation: { name: "Metinsiz", postId: null, publicReplyMessages: [] },
      }),
    ]);

    const sonuc = await eksikYorumCevaplariniTamamla();

    expect(sonuc.aday).toBe(0);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("sorgu yalnizca DM'i GITMIS + cevabi EKSIK + AKTIF kampanyayi secer", async () => {
    mockPrisma.dmLog.findMany.mockResolvedValue([]);

    await eksikYorumCevaplariniTamamla();

    const arg = mockPrisma.dmLog.findMany.mock.calls[0][0];
    expect(arg.where.status).toBe("SENT");
    expect(arg.where.publicReplySentAt).toBeNull();
    expect(arg.where.isBackfill).toBe(false);
    expect(arg.where.automation.publicReplyEnabled).toBe(true);
    expect(arg.where.automation.isActive).toBe(true);
    // Cok eski yoruma cevap dusmesin.
    const yasGun = (Date.now() - arg.where.createdAt.gte.getTime()) / 86400_000;
    expect(yasGun).toBeLessThanOrEqual(8);
  });

  it("ayni kayit ayni gun ikinci kez sayilmaz (mukerrer anahtar null doner)", async () => {
    mockPrisma.dmLog.findMany.mockResolvedValue([kayit()]);
    mockQueueAdd.mockResolvedValue(null); // dedupeKey zaten var

    const sonuc = await eksikYorumCevaplariniTamamla();

    expect(sonuc.kuyruklanan).toBe(0);
    expect(sonuc.kampanyalar).toEqual({});
  });

  it("jobId gun bazli — yarin yeniden denenebilir, bugun denenemez", async () => {
    mockPrisma.dmLog.findMany.mockResolvedValue([kayit()]);

    await eksikYorumCevaplariniTamamla();

    const jobId = mockQueueAdd.mock.calls[0][2].jobId as string;
    expect(jobId).toBe(`yorumcevabi:log1:${new Date().toISOString().slice(0, 10)}`);
  });

  it("bugun DENENMIS kayitlari atlayip tavana kadar ILERLER", async () => {
    // Asil kusur buydu: tavan kadar cekip gunluk anahtarla eleyince her tur
    // AYNI en yeni 15 kayit geliyor, ilk turdan sonra gun boyu SIFIR is
    // kuyruklaniyordu (12 saatte 205 birikime karsi 26 cevap).
    const gun = new Date().toISOString().slice(0, 10);
    const havuz = Array.from({ length: 20 }, (_, i) => kayit({ id: `log${i}` }));
    mockPrisma.dmLog.findMany.mockResolvedValue(havuz);
    mockPrisma.queueJob.findMany.mockResolvedValue(
      havuz.slice(0, 15).map((k) => ({ dedupeKey: `yorumcevabi:${k.id}:${gun}` }))
    );

    const sonuc = await eksikYorumCevaplariniTamamla(15);

    expect(sonuc.kuyruklanan).toBe(5); // eskiden 0 olurdu
    const anahtarlar = mockQueueAdd.mock.calls.map((c) => c[2].jobId);
    expect(anahtarlar).not.toContain(`yorumcevabi:log0:${gun}`);
    expect(anahtarlar).toContain(`yorumcevabi:log15:${gun}`);
  });

  it("havuzu tavandan GENIS ceker ama kuyruklamayi tavanla sinirlar", async () => {
    mockPrisma.dmLog.findMany.mockResolvedValue(
      Array.from({ length: 200 }, (_, i) => kayit({ id: `l${i}` }))
    );

    const sonuc = await eksikYorumCevaplariniTamamla();

    expect(mockPrisma.dmLog.findMany.mock.calls[0][0].take).toBeGreaterThan(
      YORUM_TUR_TAVANI
    );
    expect(sonuc.kuyruklanan).toBe(YORUM_TUR_TAVANI);
    expect(YORUM_TUR_TAVANI).toBeLessThanOrEqual(25);
  });

  it("kuru deneme hicbir sey kuyruklamaz ama adaylari sayar", async () => {
    mockPrisma.dmLog.findMany.mockResolvedValue([kayit(), kayit({ id: "log2" })]);

    const sonuc = await eksikYorumCevaplariniTamamla(15, true);

    expect(sonuc.aday).toBe(2);
    expect(sonuc.kuyruklanan).toBe(0);
    expect(sonuc.kampanyalar["CITY Şehir Promptu"]).toBe(2);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});
