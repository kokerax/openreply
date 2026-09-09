/**
 * E-posta kapisi hunisi.
 *
 * Panel yalnizca TOPLANAN adresleri gosteriyordu; adres istenip gelmeyenler
 * hicbir yerde yoktu, yani sizintinin buyuklugu olculemiyordu.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    dmLog: { groupBy: vi.fn() },
    automation: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import { epostaKapisiHunisi } from "@/lib/ops/eposta-kapisi";

const FROM = new Date("2026-08-01T00:00:00Z");
const TO = new Date("2026-09-01T00:00:00Z");

function grup(automationId: string, status: string, adet: number) {
  return { automationId, status, _count: { _all: adet } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.automation.findMany.mockResolvedValue([
    { id: "a1", name: "GTA VI Prompt" },
    { id: "a2", name: "CITY Sehir Promptu" },
  ]);
});

describe("oran ve siralama", () => {
  it("verdi/soruldu oranini kampanya bazinda hesaplar", async () => {
    mockPrisma.dmLog.groupBy.mockResolvedValue([
      grup("a1", "SENT", 61),
      grup("a1", "PENDING", 53),
      grup("a2", "SENT", 7),
      grup("a2", "PENDING", 8),
    ]);

    const h = await epostaKapisiHunisi("ws", FROM, TO);

    const gta = h.satirlar.find((s) => s.automationId === "a1")!;
    expect(gta).toMatchObject({ soruldu: 114, verdi: 61, acik: 53, oran: 53.5 });
    const city = h.satirlar.find((s) => s.automationId === "a2")!;
    expect(city).toMatchObject({ soruldu: 15, verdi: 7, acik: 8, oran: 46.7 });
  });

  it("en cok sorulan kampanya basta", async () => {
    mockPrisma.dmLog.groupBy.mockResolvedValue([
      grup("a2", "SENT", 7),
      grup("a2", "PENDING", 8),
      grup("a1", "SENT", 61),
      grup("a1", "PENDING", 53),
    ]);

    const h = await epostaKapisiHunisi("ws", FROM, TO);

    expect(h.satirlar.map((s) => s.automationId)).toEqual(["a1", "a2"]);
  });

  it("TOPLAM parcalarin toplamina esit — bolumleme kontrolu", async () => {
    mockPrisma.dmLog.groupBy.mockResolvedValue([
      grup("a1", "SENT", 61),
      grup("a1", "PENDING", 53),
      grup("a2", "SENT", 7),
      grup("a2", "PENDING", 8),
    ]);

    const h = await epostaKapisiHunisi("ws", FROM, TO);

    expect(h.toplam.soruldu).toBe(h.satirlar.reduce((t, s) => t + s.soruldu, 0));
    expect(h.toplam.verdi).toBe(h.satirlar.reduce((t, s) => t + s.verdi, 0));
    // acik ayri toplanmiyor, farktan turuyor: ikisi tutmali.
    expect(h.toplam.acik).toBe(h.satirlar.reduce((t, s) => t + s.acik, 0));
    expect(h.toplam.oran).toBe(52.7);
  });
});

describe("sorgu DOGRU evreni secer", () => {
  it("yalnizca emailgate defter satirlarini sayar", async () => {
    mockPrisma.dmLog.groupBy.mockResolvedValue([]);

    await epostaKapisiHunisi("ws", FROM, TO);

    const w = mockPrisma.dmLog.groupBy.mock.calls[0][0].where;
    // Gercek yorumlar da reveal:/followgate: satirlari da bu huniye girmemeli.
    expect(w.commentId).toEqual({ startsWith: "emailgate:" });
    expect(w.isBackfill).toBe(false);
    expect(w.createdAt).toEqual({ gte: FROM, lt: TO });
  });

  it("hesap secilince sorguya girer, secilmeyince GIRMEZ", async () => {
    mockPrisma.dmLog.groupBy.mockResolvedValue([]);

    await epostaKapisiHunisi("ws", FROM, TO, { instagramAccountId: "acct_1" });
    expect(mockPrisma.dmLog.groupBy.mock.calls[0][0].where.instagramAccountId).toBe(
      "acct_1"
    );

    mockPrisma.dmLog.groupBy.mockClear();
    await epostaKapisiHunisi("ws", FROM, TO);
    expect(
      mockPrisma.dmLog.groupBy.mock.calls[0][0].where.instagramAccountId
    ).toBeUndefined();
  });

  it("KAMPANYA secilince huni de daralir", async () => {
    // Canli panelde yakalandi: Leads sayfasinda CITY secildi, TABLO 7 satira
    // dustu ama serit hala 129/68 (tum kampanyalar) yaziyordu. Rota
    // `automationId`'yi hic okumuyordu.
    mockPrisma.dmLog.groupBy.mockResolvedValue([]);

    await epostaKapisiHunisi("ws", FROM, TO, { automationId: "a2" });
    expect(mockPrisma.dmLog.groupBy.mock.calls[0][0].where.automationId).toBe("a2");

    mockPrisma.dmLog.groupBy.mockClear();
    await epostaKapisiHunisi("ws", FROM, TO);
    expect(
      mockPrisma.dmLog.groupBy.mock.calls[0][0].where.automationId
    ).toBeUndefined();
  });
});

describe("kenar durumlar sessizce veri dusurmez", () => {
  it("SENT/PENDING disindaki durumlar AYRICA raporlanir", async () => {
    mockPrisma.dmLog.groupBy.mockResolvedValue([
      grup("a1", "SENT", 10),
      grup("a1", "PENDING", 5),
      grup("a1", "FAILED", 3),
    ]);

    const h = await epostaKapisiHunisi("ws", FROM, TO);

    // Oran yalnizca kapinin URETTIGI iki durumdan; ucuncusu gizlenmez.
    expect(h.satirlar[0]).toMatchObject({ soruldu: 15, verdi: 10, oran: 66.7 });
    expect(h.digerDurum).toBe(3);
  });

  it("adi cozulemeyen kampanya DUSURULMEZ, id ile gosterilir", async () => {
    mockPrisma.dmLog.groupBy.mockResolvedValue([grup("silinmis", "SENT", 4)]);
    mockPrisma.automation.findMany.mockResolvedValue([]);

    const h = await epostaKapisiHunisi("ws", FROM, TO);

    // Satiri dusurmek toplami sessizce eksiltirdi.
    expect(h.satirlar).toHaveLength(1);
    expect(h.satirlar[0].automationName).toBe("silinmis");
    expect(h.toplam.verdi).toBe(4);
  });

  it("hic kayit yoksa cokmez ve kampanya sorgusu HIC yapilmaz", async () => {
    mockPrisma.dmLog.groupBy.mockResolvedValue([]);

    const h = await epostaKapisiHunisi("ws", FROM, TO);

    expect(h.satirlar).toEqual([]);
    expect(h.toplam).toEqual({ soruldu: 0, verdi: 0, acik: 0, oran: 0 });
    // Sifira bolme yok, bos `in` sorgusu da yok.
    expect(mockPrisma.automation.findMany).not.toHaveBeenCalled();
  });

  it("hepsi acikken oran SIFIR, hepsi verdiyse YUZ — iki uc de dogru", async () => {
    mockPrisma.dmLog.groupBy.mockResolvedValue([grup("a1", "PENDING", 9)]);
    expect((await epostaKapisiHunisi("ws", FROM, TO)).toplam.oran).toBe(0);

    mockPrisma.dmLog.groupBy.mockResolvedValue([grup("a1", "SENT", 9)]);
    expect((await epostaKapisiHunisi("ws", FROM, TO)).toplam.oran).toBe(100);
  });
});
