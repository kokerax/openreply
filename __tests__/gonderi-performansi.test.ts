/**
 * Gonderi bazinda performans.
 *
 * "Hangi reel is yariyor" sorusu hicbir yerde cevaplanmiyordu: kampanyalarin
 * cogu `matchAnyPost` ile calisiyor, yani TEK kampanya onlarca gonderiyi
 * kapsiyor.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockGetMedia, mockDecrypt } = vi.hoisted(() => ({
  mockPrisma: {
    dmLog: { groupBy: vi.fn() },
    instagramAccount: { findFirst: vi.fn() },
  },
  mockGetMedia: vi.fn(),
  mockDecrypt: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/client", () => ({ getMediaById: mockGetMedia }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: mockDecrypt }));

import {
  GONDERI_TAVANI,
  gonderiPerformansi,
} from "@/lib/ops/gonderi-performansi";

type GroupArgs = { where: Record<string, unknown> & { createdAt?: unknown; mediaId?: { in?: string[] } } };

const FROM = new Date("2026-08-01T00:00:00Z");
const TO = new Date("2026-09-01T00:00:00Z");

function grup(mediaId: string, adet: number, originalMediaId: string | null = null) {
  return { mediaId, originalMediaId, _count: { _all: adet } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.instagramAccount.findFirst.mockResolvedValue({ accessToken: "enc" });
  mockDecrypt.mockReturnValue("token");
  mockGetMedia.mockResolvedValue({
    permalink: "https://instagram.com/p/abc",
    thumbnail_url: "https://cdn/t.jpg",
    caption: "bir baslik",
    timestamp: "2026-08-15T10:00:00Z",
  });
});

describe("siralama ve reklam isareti", () => {
  it("en cok DM alan gonderi basta", async () => {
    mockPrisma.dmLog.groupBy.mockResolvedValue([
      grup("az", 5),
      grup("cok", 126),
      grup("orta", 40),
    ]);

    const s = await gonderiPerformansi("ws", FROM, TO);

    expect(s.satirlar.map((x) => x.mediaId)).toEqual(["cok", "orta", "az"]);
    expect(s.toplamGonderi).toBe(3);
  });

  it("reklam kopyasini isaretler, organigi isaretlemez", async () => {
    mockPrisma.dmLog.groupBy.mockResolvedValue([
      grup("reklam_kopyasi", 18, "asil_post"),
      grup("organik", 20, null),
    ]);

    const s = await gonderiPerformansi("ws", FROM, TO);

    expect(s.satirlar.find((x) => x.mediaId === "reklam_kopyasi")?.reklam).toBe(true);
    expect(s.satirlar.find((x) => x.mediaId === "organik")?.reklam).toBe(false);
  });

  it("tavani asmaz ama TOPLAMI dogru raporlar", async () => {
    mockPrisma.dmLog.groupBy.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => grup(`m${i}`, 30 - i))
    );

    const s = await gonderiPerformansi("ws", FROM, TO);

    expect(s.satirlar.length).toBe(GONDERI_TAVANI);
    // Kac birim islendigi gizlenmez: 8 gosteriyoruz ama 30 var.
    expect(s.toplamGonderi).toBe(30);
  });
});

describe("yorum -> DM donusumu", () => {
  it("oran OMUR BOYU sayilardan hesaplanir, aralik sayisindan DEGIL", async () => {
    // Tuzak: `dm` secili ARALIGA ait, `comments_count` ise gonderinin OMUR
    // BOYU toplami. Ikisini bolmek "son 7 gun"de 5/3550 = %0,1 gibi sacma
    // bir oran uretirdi. Bugun sistem 9 gunluk oldugu icin ikisi ayni —
    // yani bu hata BUGUN gorunmez, 40 gun sonra gorunur.
    mockPrisma.dmLog.groupBy.mockImplementation(async (args: GroupArgs) =>
      args.where.createdAt
        ? [grup("post", 30)] // aralik icinde 30
        : [grup("post", 120)] // omur boyu 120
    );
    mockGetMedia.mockResolvedValue({ permalink: "p", comments_count: 240 });

    const s = await gonderiPerformansi("ws", FROM, TO);

    expect(s.satirlar[0].dm).toBe(30);
    expect(s.satirlar[0].dmOmur).toBe(120);
    expect(s.satirlar[0].yorum).toBe(240);
    // 120/240 = %50. Aralik sayisini kullansaydi %12,5 derdi.
    expect(s.satirlar[0].donusum).toBe(50);
  });

  it("yorum sayisi cozulemezse oran NULL — sifir degil", async () => {
    // Sifir yazmak "hic donusturmedi" demek olurdu; bilmiyoruz.
    mockPrisma.dmLog.groupBy.mockResolvedValue([grup("m", 10)]);
    mockGetMedia.mockResolvedValue({ permalink: "p" });

    const s = await gonderiPerformansi("ws", FROM, TO);

    expect(s.satirlar[0].yorum).toBeNull();
    expect(s.satirlar[0].donusum).toBeNull();
  });

  it("yorum SIFIR ise oran NULL — sifira bolme yok", async () => {
    mockPrisma.dmLog.groupBy.mockResolvedValue([grup("m", 3)]);
    mockGetMedia.mockResolvedValue({ permalink: "p", comments_count: 0 });

    const s = await gonderiPerformansi("ws", FROM, TO);

    expect(s.satirlar[0].donusum).toBeNull();
  });

  it("omur boyu sorgusu YALNIZCA gosterilen gonderiler icin yapilir", async () => {
    mockPrisma.dmLog.groupBy.mockImplementation(async (args: GroupArgs) =>
      args.where.createdAt
        ? Array.from({ length: 30 }, (_, i) => grup(`m${i}`, 30 - i))
        : []
    );

    await gonderiPerformansi("ws", FROM, TO);

    const omurCagrisi = mockPrisma.dmLog.groupBy.mock.calls
      .map((c) => c[0])
      .find((a: GroupArgs) => !a.where.createdAt);
    // 30 gonderiden yalnizca tavan kadari cizilecek; hepsini omur boyu
    // saymak bosuna is olurdu.
    expect(omurCagrisi.where.mediaId.in).toHaveLength(GONDERI_TAVANI);
  });
});

describe("sorgu dogru evreni secer", () => {
  it("muhur, defter satiri ve medyasizlari eler", async () => {
    mockPrisma.dmLog.groupBy.mockResolvedValue([]);

    await gonderiPerformansi("ws", FROM, TO);

    const w = mockPrisma.dmLog.groupBy.mock.calls[0][0].where;
    expect(w.isBackfill).toBe(false);
    expect(w.status).toBe("SENT");
    // Defter satirlarinin (emailgate:/reveal:) medyasi YOKTUR.
    expect(w.commentId).toEqual({ not: { contains: ":" } });
    expect(w.mediaId).toEqual({ not: null });
    expect(w.createdAt).toEqual({ gte: FROM, lt: TO });
  });

  it("hesap secilince sorguya girer, 'all' secilince GIRMEZ", async () => {
    mockPrisma.dmLog.groupBy.mockResolvedValue([]);

    await gonderiPerformansi("ws", FROM, TO, "acct_1");
    expect(mockPrisma.dmLog.groupBy.mock.calls[0][0].where.instagramAccountId).toBe("acct_1");

    mockPrisma.dmLog.groupBy.mockClear();
    await gonderiPerformansi("ws", FROM, TO);
    expect(
      mockPrisma.dmLog.groupBy.mock.calls[0][0].where.instagramAccountId
    ).toBeUndefined();
  });
});

describe("medya cozulemeyince COKMEZ", () => {
  it("permalink null kalir, sayilar yine doner, cozulemeyen raporlanir", async () => {
    mockPrisma.dmLog.groupBy.mockResolvedValue([grup("silinmis", 10), grup("saglam", 5)]);
    mockGetMedia.mockImplementation(async (_t: string, id: string) =>
      id === "silinmis" ? null : { permalink: "https://instagram.com/p/ok" }
    );

    const s = await gonderiPerformansi("ws", FROM, TO);

    // Silinmis bir gonderi tum listeyi cokertmemeli.
    expect(s.satirlar.find((x) => x.mediaId === "silinmis")?.permalink).toBeNull();
    expect(s.satirlar.find((x) => x.mediaId === "silinmis")?.dm).toBe(10);
    expect(s.cozulemeyen).toBe(1);
  });

  it("token cozulemezse sayilar YINE doner", async () => {
    mockPrisma.dmLog.groupBy.mockResolvedValue([grup("m", 7)]);
    mockDecrypt.mockImplementation(() => {
      throw new Error("bozuk anahtar");
    });

    const s = await gonderiPerformansi("ws", FROM, TO);

    expect(s.satirlar[0].dm).toBe(7);
    expect(s.satirlar[0].permalink).toBeNull();
    expect(mockGetMedia).not.toHaveBeenCalled();
  });
});
