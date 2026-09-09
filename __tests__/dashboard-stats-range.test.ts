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
    linkClick: { count: vi.fn(), groupBy: vi.fn() },
    // Webhook rozeti artik davranistan ve HESAP BASINA turuyor.
    webhookEvent: { findFirst: vi.fn() },
    $queryRaw: vi.fn(),
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

/** Route artik satirdan mediaId/originalMediaId de okuyor (reklam kirilimi). */
type SentRow = {
  createdAt: Date;
  mediaId?: string | null;
  originalMediaId?: string | null;
  /** Sentetik defter satirlarini ayirt etmek icin (icinde ":" olanlar). */
  commentId?: string;
};

function primeHappyPath(girdiler: SentRow[] = []) {
  // Gercek yorum kimlikleri tamamen rakamdir; fixture varsayilani da oyle
  // olmali, yoksa satirlar yanlislikla "sentetik" sayilir.
  const sentRows = girdiler.map((r, i) => ({ commentId: `1790000000000000${i}`, ...r }));
  mockWorkspaceId.mockResolvedValue("ws_1");
  mockUserId.mockResolvedValue("user_1");
  mockPrisma.workspace.findUnique.mockResolvedValue({ name: "WS", dmsSentThisPeriod: 0 });
  mockPrisma.instagramAccount.findFirst.mockResolvedValue(null);
  mockPrisma.instagramAccount.findMany.mockResolvedValue([]);
  mockPrisma.automation.count.mockResolvedValue(3);
  mockPrisma.dmLog.count.mockResolvedValue(7);
  mockPrisma.dmLog.groupBy.mockResolvedValue([]);
  mockPrisma.linkClick.count.mockResolvedValue(2);
  mockPrisma.linkClick.groupBy.mockResolvedValue([]);
  mockPrisma.webhookEvent.findFirst.mockResolvedValue(null);
  mockPrisma.$queryRaw.mockResolvedValue([]);
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

  it("tz verilince gunler KULLANICININ takvimine gore kovalanir", async () => {
    // Kusur: "bugun" ve gunluk seri sunucunun (Vercel = UTC) takvimine gore
    // hesaplaniyordu. +03'te 21:30Z ERTESI yerel gundur; UTC kovalamasi onu
    // bir onceki gune yaziyordu.
    primeHappyPath([
      { createdAt: new Date("2026-08-02T21:30:00.000Z") }, // Istanbul: 08-03
      { createdAt: new Date("2026-08-03T05:00:00.000Z") }, // Istanbul: 08-03
    ]);

    const res = await GET(req("?from=2026-08-01&to=2026-08-05&tz=Europe/Istanbul"));
    const body = await res.json();

    expect(body.data.timeZone).toBe("Europe/Istanbul");
    const gun = (d: string) =>
      body.data.dailyDMs.find((x: { date: string }) => x.date === d)?.count;
    expect(gun("2026-08-03")).toBe(2); // ikisi de ayni YEREL gunde
    expect(gun("2026-08-02")).toBe(0);
  });

  it("'bugun' sinirini KULLANICININ bolgesinden alir, sunucununkinden degil", async () => {
    // Mutasyon notu: bu test yazilmadan once `todayStart`i UTC'ye sabitleyen
    // mutasyon YESIL kaliyordu — yani sinir hic sinanmiyordu.
    vi.setSystemTime(new Date("2026-09-09T01:00:00.000Z")); // Istanbul 04:00
    primeHappyPath();

    await GET(req("?from=2026-08-01&to=2026-09-09&tz=Europe/Istanbul"));

    const gunlukSorgu = mockPrisma.dmLog.count.mock.calls
      .map((c) => c[0]?.where?.createdAt?.gte as Date | undefined)
      .filter((d): d is Date => d instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    // Istanbul'da 2026-09-09 gece yarisi = 2026-09-08T21:00Z.
    // UTC hesabi 2026-09-09T00:00Z verirdi ve gece yarisi-03:00 arasindaki
    // gonderimleri "bugun"den dislardi.
    expect(gunlukSorgu?.toISOString()).toBe("2026-09-08T21:00:00.000Z");
    vi.useRealTimers();
  });

  it("ILERI TARIHLI bos gun gostermez", async () => {
    // +03'te araligin son UTC ani ertesi yerel gune duser; grafikte henuz
    // gelmemis bir gun bos sutun olarak cikiyordu.
    vi.setSystemTime(new Date("2026-09-09T01:00:00.000Z")); // Istanbul 04:00
    primeHappyPath();

    const res = await GET(req("?from=2026-09-01&to=2026-09-09&tz=Europe/Istanbul"));
    const gunler = (await res.json()).data.dailyDMs.map((d: { date: string }) => d.date);

    expect(gunler).not.toContain("2026-09-10");
    expect(gunler[gunler.length - 1]).toBe("2026-09-09");
    vi.useRealTimers();
  });

  it("reklam/organik kirilimini uc kovada verir", async () => {
    primeHappyPath([
      { createdAt: new Date("2026-08-02T05:00:00.000Z"), mediaId: "reklam_1", originalMediaId: "asil" },
      { createdAt: new Date("2026-08-02T06:00:00.000Z"), mediaId: "reklam_1", originalMediaId: "asil" },
      { createdAt: new Date("2026-08-03T05:00:00.000Z"), mediaId: "asil", originalMediaId: null },
      // Alan yazilmadan onceki kayit: ORGANIGE sayilmamali.
      { createdAt: new Date("2026-08-04T05:00:00.000Z"), mediaId: null, originalMediaId: null },
    ]);

    const res = await GET(req("?from=2026-08-01&to=2026-08-05"));
    const d = (await res.json()).data;

    expect(d.sourceSplit).toEqual({ ad: 2, organic: 1, unknown: 1 });
    // Kirilim toplami gonderim sayisiyla TUTMALI.
    const t = d.sourceSplit.ad + d.sourceSplit.organic + d.sourceSplit.unknown;
    expect(t).toBe(d.dailyDMs.reduce((a: number, x: { count: number }) => a + x.count, 0));
  });

  it("SENTETIK defter satirlari kaynak kirilimina GIRMEZ", async () => {
    // "Not tracked" 306 gorunuyordu ama 247'si emailgate:/reveal:/dm: satiriydi
    // — yorum bile degil, medyasi HIC olmaz. Kart "yorumlar nereden geldi"
    // diyor; yorum olmayani saymak sayiyi sisiriyordu.
    primeHappyPath([
      { createdAt: new Date("2026-08-02T05:00:00.000Z"), commentId: "17900000001", mediaId: "post", originalMediaId: null },
      { createdAt: new Date("2026-08-02T06:00:00.000Z"), commentId: "emailgate:123", mediaId: null, originalMediaId: null },
      { createdAt: new Date("2026-08-02T07:00:00.000Z"), commentId: "reveal:123", mediaId: null, originalMediaId: null },
    ]);

    const d = (await (await GET(req("?from=2026-08-01&to=2026-08-05"))).json()).data;

    expect(d.sourceSplit).toEqual({ ad: 0, organic: 1, unknown: 0 });
    // ESKIDEN burada 3 bekleniyordu: "grafik tum gonderimleri sayar, kirilim
    // yalnizca yorumlari — ikisi ayri sorulardir." Bu gerekce canli panelde
    // yanlis cikti: KPI 666 derken hemen altindaki kirilim 419 diyordu ve
    // ayni ekrandaki iki sayi birbirini yalanliyordu. Grafik de kirilim de
    // AYNI evrenden (yoruma gonderilen DM) sayar; takip mesajlari
    // `followUpMessages` alaninda ayrica gorunur.
    const toplamGonderim = d.dailyDMs.reduce((a: number, x: { count: number }) => a + x.count, 0);
    expect(toplamGonderim).toBe(1);
    expect(d.followUpMessages).toBe(2);
  });

  it("KARSI YON: hepsi organikse reklam sifir", async () => {
    primeHappyPath([
      { createdAt: new Date("2026-08-02T05:00:00.000Z"), mediaId: "asil", originalMediaId: null },
    ]);

    const res = await GET(req("?from=2026-08-01&to=2026-08-05"));

    expect((await res.json()).data.sourceSplit).toEqual({ ad: 0, organic: 1, unknown: 0 });
  });

  it("KARSI YON: tz YOKSA eski UTC davranisi aynen surer", async () => {
    primeHappyPath([
      { createdAt: new Date("2026-08-02T21:30:00.000Z") },
      { createdAt: new Date("2026-08-03T05:00:00.000Z") },
    ]);

    const res = await GET(req("?from=2026-08-01&to=2026-08-05"));
    const body = await res.json();

    expect(body.data.timeZone).toBe("UTC");
    const gun = (d: string) =>
      body.data.dailyDMs.find((x: { date: string }) => x.date === d)?.count;
    expect(gun("2026-08-02")).toBe(1); // UTC'de ayri gunler
    expect(gun("2026-08-03")).toBe(1);
  });

  it("gecersiz tz sessizce UTC'ye duser, cokmez", async () => {
    primeHappyPath([{ createdAt: new Date("2026-08-02T05:00:00.000Z") }]);

    const res = await GET(req("?from=2026-08-01&to=2026-08-05&tz=Mars/Olympus"));

    expect(res.status).toBe(200);
    expect((await res.json()).data.timeZone).toBe("UTC");
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

/**
 * Ayni ekranda iki sayi celisiyordu: KPI karti "DMs Sent 666" derken hemen
 * altindaki kaynak dagilimi 419 diyordu. Fark 247 sentetik defter satiri
 * (reveal:/emailgate:/dm:) — bunlar kampanya DM'i degil, TAKIP mesaji.
 *
 * Sonuc yalnizca kozmetik degildi: CTR paydasi 666'ya sisiyor ve donusum
 * %27,5 gorunuyordu; gercegi 154/419 = %36,8.
 */
describe("webhook rozeti HESAP BASINA", () => {
  it("sessiz hesap, mesgul hesabin tazeligini MIRAS ALMAZ", async () => {
    // Tek bir workspace sorgusu kullanildiginda iki hesap ayni rozeti
    // aliyordu; yuk zaten hedef hesabin kimligini tasiyor.
    const simdi = new Date();
    primeHappyPath([]);
    mockPrisma.instagramAccount.findMany.mockResolvedValue([
      { id: "a1", username: "mesgul", instagramId: "IG_MESGUL", name: null,
        tokenExpiresAt: null, webhookSubscribed: false },
      { id: "a2", username: "sessiz", instagramId: "IG_SESSIZ", name: null,
        tokenExpiresAt: null, webhookSubscribed: false },
    ]);
    mockPrisma.$queryRaw.mockResolvedValue([
      { ig: "IG_MESGUL", son: new Date(simdi.getTime() - 3600_000) },
    ]);

    const body = await (await GET(req("?from=2026-08-01&to=2026-08-05"))).json();
    const durum = Object.fromEntries(
      body.data.instagramAccounts.map((h: { username: string; webhookDurumu: string }) => [
        h.username,
        h.webhookDurumu,
      ])
    );

    expect(durum.mesgul).toBe("bayrak-bayat");
    expect(durum.sessiz).toBe("bekliyor");
  });

  it("KARSI YON: her iki hesap da olay aliyorsa ikisi de taze", async () => {
    const simdi = new Date();
    primeHappyPath([]);
    mockPrisma.instagramAccount.findMany.mockResolvedValue([
      { id: "a1", username: "bir", instagramId: "IG_1", name: null,
        tokenExpiresAt: null, webhookSubscribed: true },
      { id: "a2", username: "iki", instagramId: "IG_2", name: null,
        tokenExpiresAt: null, webhookSubscribed: true },
    ]);
    mockPrisma.$queryRaw.mockResolvedValue([
      { ig: "IG_1", son: new Date(simdi.getTime() - 60_000) },
      { ig: "IG_2", son: new Date(simdi.getTime() - 60_000) },
    ]);

    const body = await (await GET(req("?from=2026-08-01&to=2026-08-05"))).json();
    for (const h of body.data.instagramAccounts) {
      expect(h.webhookDurumu, h.username).toBe("calisiyor");
    }
  });
});

describe("tek evren: KPI, grafik ve dagilim ayni sayiyi anlatir", () => {
  /** status=SENT olan her dmLog.count cagrisinin where'i. */
  function sentSayimlari() {
    return mockPrisma.dmLog.count.mock.calls
      .map((c) => c[0]?.where)
      .filter((w) => w?.status === "SENT");
  }

  it("SENT sayimlari sentetik defter satirlarini SAYMAZ", async () => {
    primeHappyPath([]);
    await GET(req("?from=2026-08-01&to=2026-08-05"));

    const sayimlar = sentSayimlari();
    // Bugun, hafta, aralik ve tum-zaman: dordu de.
    expect(sayimlar.length).toBeGreaterThanOrEqual(4);
    for (const w of sayimlar) {
      expect(w.commentId).toEqual({ not: { contains: ":" } });
      // Karsi yon: goc muhurleri hala eleniyor olmali.
      expect(w.isBackfill).toBe(false);
    }
  });

  it("takip mesajlari GIZLENMEZ, ayri alanda raporlanir", async () => {
    primeHappyPath([
      { createdAt: new Date("2026-08-02T05:00:00.000Z") },
      { createdAt: new Date("2026-08-02T06:00:00.000Z"), commentId: "reveal:p1" },
      { createdAt: new Date("2026-08-03T06:00:00.000Z"), commentId: "emailgate:p2" },
    ]);

    const body = await (await GET(req("?from=2026-08-01&to=2026-08-05"))).json();

    // Gonderilen mesaj kayboluyor gibi gorunmemeli: 247 satirin nereye
    // gittigi ekranda yazili olmali.
    expect(body.data.followUpMessages).toBe(2);
  });

  it("gunluk grafik de sentetikleri saymaz — dagilimla TOPLAMI tutar", async () => {
    primeHappyPath([
      { createdAt: new Date("2026-08-02T05:00:00.000Z") },
      { createdAt: new Date("2026-08-02T06:00:00.000Z"), commentId: "reveal:p1" },
      { createdAt: new Date("2026-08-02T07:00:00.000Z"), commentId: "emailgate:p2" },
      { createdAt: new Date("2026-08-04T12:00:00.000Z") },
    ]);

    const body = await (await GET(req("?from=2026-08-01&to=2026-08-05"))).json();
    const seriToplam = body.data.dailyDMs.reduce(
      (a: number, g: { count: number }) => a + g.count,
      0
    );
    const s = body.data.sourceSplit;

    expect(seriToplam).toBe(2);
    // Ic tutarlilik caprazi: grafik ve dagilim ayni evrenden.
    expect(seriToplam).toBe(s.ad + s.organic + s.unknown);
  });

  it("CTR TEKIL tiklamadan hesaplanir, toplam tiklamadan degil", async () => {
    primeHappyPath([]);
    mockPrisma.dmLog.count.mockResolvedValue(10);
    // 4 tiklama ama 2 tekil kisi.
    mockPrisma.linkClick.count.mockResolvedValue(4);
    mockPrisma.linkClick.groupBy.mockResolvedValue([
      { ipHash: "a", _count: { _all: 3 } },
      { ipHash: "b", _count: { _all: 1 } },
    ]);

    const body = await (await GET(req("?from=2026-08-01&to=2026-08-05"))).json();

    expect(body.data.clicksThisMonth).toBe(4);
    expect(body.data.uniqueClicksThisMonth).toBe(2);
    // 2/10 = %20; toplamla hesaplasaydi %40 derdi.
    expect(body.data.ctrThisMonth).toBe(20);
  });

  it("ipHash'i OLMAYAN eski tiklamalar tekillestirilemez, teker teker sayilir", async () => {
    primeHappyPath([]);
    mockPrisma.dmLog.count.mockResolvedValue(10);
    mockPrisma.linkClick.count.mockResolvedValue(5);
    mockPrisma.linkClick.groupBy.mockResolvedValue([
      { ipHash: null, _count: { _all: 3 } },
      { ipHash: "a", _count: { _all: 2 } },
    ]);

    const body = await (await GET(req("?from=2026-08-01&to=2026-08-05"))).json();

    // 3 kimliksiz + 1 tekil = 4. Hepsini "1 kisi" saymak donusumu gizlerdi.
    expect(body.data.uniqueClicksThisMonth).toBe(4);
  });
});
