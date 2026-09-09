import { describe, expect, it } from "vitest";
import {
  bucketDaily,
  buildCampaignAnalytics,
  classifyDevice,
  normalizeFailure,
  normalizeReferrer,
  topCounts,
} from "../app/api/automations/[id]/analytics/compute";

const D = (iso: string) => new Date(iso);

describe("bucketDaily", () => {
  it("zero-fills every day and drops rows outside the range", () => {
    const keys = ["2026-08-01", "2026-08-02", "2026-08-03"];
    const rows = bucketDaily(
      keys,
      [D("2026-08-01T10:00:00Z"), D("2026-08-01T23:59:59Z"), D("2026-08-03T00:00:00Z"), D("2026-07-31T23:59:59Z")],
      [D("2026-08-02T05:00:00Z"), D("2026-08-04T00:00:00Z")]
    );
    expect(rows).toEqual([
      { date: "2026-08-01", sent: 2, clicks: 0 },
      { date: "2026-08-02", sent: 0, clicks: 1 },
      { date: "2026-08-03", sent: 1, clicks: 0 },
    ]);
  });
});

describe("normalizeReferrer", () => {
  it("strips www and lowercases; empty is (direct)", () => {
    expect(normalizeReferrer("https://www.Instagram.com/p/abc")).toBe("instagram.com");
    expect(normalizeReferrer("https://l.instagram.com/?u=x")).toBe("l.instagram.com");
    expect(normalizeReferrer(null)).toBe("(direct)");
    expect(normalizeReferrer("   ")).toBe("(direct)");
    expect(normalizeReferrer("android-app://com.instagram.android")).toBe("com.instagram.android");
  });
});

describe("classifyDevice", () => {
  it("separates mobile, desktop and other — both directions", () => {
    expect(classifyDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Instagram 300.0")).toBe("mobile");
    expect(classifyDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari")).toBe("mobile");
    expect(classifyDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120")).toBe("desktop");
    expect(classifyDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari")).toBe("desktop");
    expect(classifyDevice("facebookexternalhit/1.1")).toBe("other");
    expect(classifyDevice("curl/8.0")).toBe("other");
    expect(classifyDevice(null)).toBe("other");
    expect(classifyDevice("")).toBe("other");
  });
});

describe("normalizeFailure", () => {
  it("collapses whitespace and trace ids so repeats group", () => {
    expect(normalizeFailure("  (#10) User   not reachable fbtrace_id: AbC123 ")).toBe(
      "(#10) User not reachable"
    );
    expect(normalizeFailure("(#10) User not reachable fbtrace_id=XyZ")).toBe(
      "(#10) User not reachable"
    );
    expect(normalizeFailure(null)).toBe("Unknown error");
    expect(normalizeFailure("")).toBe("Unknown error");
  });
});

describe("topCounts", () => {
  it("sorts by count desc then key asc and caps at limit", () => {
    expect(topCounts(["b", "a", "b", "c", "a", "d"], 3)).toEqual([
      { key: "a", count: 2 },
      { key: "b", count: 2 },
      { key: "c", count: 1 },
    ]);
  });
});

describe("reklam / organik kirilimi", () => {
  const taban = {
    dayKeys: ["2026-08-01"],
    comments: 3,
    clicks: [],
    failures: [],
  };
  const G = (n: number) => Array.from({ length: n }, () => D("2026-08-01T01:00:00Z"));

  it("originalMediaId dolu olani REKLAM sayar", () => {
    const out = buildCampaignAnalytics({
      ...taban,
      sentAt: G(3),
      sentSources: [
        { mediaId: "reklam_1", originalMediaId: "asil_post" },
        { mediaId: "reklam_1", originalMediaId: "asil_post" },
        { mediaId: "asil_post", originalMediaId: null },
      ],
    });

    expect(out.sourceSplit).toEqual({ ad: 2, organic: 1, unknown: 0 });
  });

  it("KARSI YON: hepsi organikse reklam sifir", () => {
    const out = buildCampaignAnalytics({
      ...taban,
      sentAt: G(2),
      sentSources: [
        { mediaId: "post", originalMediaId: null },
        { mediaId: "post", originalMediaId: null },
      ],
    });

    expect(out.sourceSplit).toEqual({ ad: 0, organic: 2, unknown: 0 });
  });

  it("alan yazilmadan onceki kayitlari ORGANIGE SAYMAZ", () => {
    // Bu en kritik assert: eski kayitlari organik saymak gecmisi oldugundan
    // daha organik gosterir ve reklamin katkisini gizler.
    const out = buildCampaignAnalytics({
      ...taban,
      sentAt: G(2),
      sentSources: [
        { mediaId: null, originalMediaId: null },
        { mediaId: "post", originalMediaId: null },
      ],
    });

    expect(out.sourceSplit).toEqual({ ad: 0, organic: 1, unknown: 1 });
  });

  it("kaynak hic verilmezse hepsi 'bilinmiyor' olur, sifir reklam DEGIL", () => {
    const out = buildCampaignAnalytics({ ...taban, sentAt: G(4) });

    expect(out.sourceSplit).toEqual({ ad: 0, organic: 0, unknown: 4 });
  });

  it("kirilim toplami gonderim sayisini asmaz ve tutar", () => {
    const out = buildCampaignAnalytics({
      ...taban,
      sentAt: G(3),
      sentSources: [
        { mediaId: "r", originalMediaId: "p" },
        { mediaId: "p", originalMediaId: null },
        { mediaId: null, originalMediaId: null },
      ],
    });

    const { ad, organic, unknown } = out.sourceSplit;
    // Kirilim yalnizca GERCEK YORUMLARI anlatir; gonderim sayisi e-posta
    // kapisi gibi yorumsuz mesajlari da icerir, o yuzden ASMAZ ama esit
    // olmak zorunda da degildir.
    expect(ad + organic + unknown).toBeLessThanOrEqual(out.funnel.dmsSent);
  });
});

describe("tekil tiklama ve durust CTR", () => {
  const T = (saat: number, ip: string | null) => ({
    createdAt: D(`2026-08-01T0${saat}:00:00Z`),
    referrer: null,
    userAgent: "iPhone",
    ipHash: ip,
  });
  const taban = {
    dayKeys: ["2026-08-01"],
    comments: 5,
    sentAt: [D("2026-08-01T01:00:00Z"), D("2026-08-01T02:00:00Z")],
    failures: [],
  };

  it("ayni kisinin tekrar tiklamasi orani sismez", () => {
    // Tek kisi (ayni ipHash) uc kez tikladi, iki DM gitti.
    const out = buildCampaignAnalytics({
      ...taban,
      clicks: [T(3, "ayni"), T(4, "ayni"), T(5, "ayni")],
    });

    expect(out.funnel.clicks).toBe(3); // ham sayim korunuyor
    expect(out.funnel.uniqueClicks).toBe(1);
    expect(out.funnel.ctr).toBe(50); // 1/2, eskiden 100'e kirpilmis 150 idi
    expect(out.funnel.clicksExceedSends).toBe(true);
  });

  it("KARSI YON: farkli kisiler ayri sayilir", () => {
    const out = buildCampaignAnalytics({
      ...taban,
      clicks: [T(3, "bir"), T(4, "iki")],
    });

    expect(out.funnel.uniqueClicks).toBe(2);
    expect(out.funnel.ctr).toBe(100);
    expect(out.funnel.clicksExceedSends).toBe(false);
  });

  it("ipHash'i olmayan eski kayitlar birlestirilmez", () => {
    // null'lari tek kisiye indirgemek gecmisi oldugundan kucuk gosterirdi.
    const out = buildCampaignAnalytics({
      ...taban,
      clicks: [T(3, null), T(4, null)],
    });

    expect(out.funnel.uniqueClicks).toBe(2);
  });

  it("gonderim yoksa oran 0, bolme hatasi yok", () => {
    const out = buildCampaignAnalytics({
      ...taban,
      sentAt: [],
      clicks: [T(3, "bir")],
    });

    expect(out.funnel.ctr).toBe(0);
    expect(out.funnel.clicksExceedSends).toBe(false);
  });
});

describe("buildCampaignAnalytics", () => {
  it("computes the funnel with capped CTR and fixed device order", () => {
    const out = buildCampaignAnalytics({
      dayKeys: ["2026-08-01", "2026-08-02"],
      comments: 10,
      sentAt: [D("2026-08-01T01:00:00Z"), D("2026-08-01T02:00:00Z"), D("2026-08-02T03:00:00Z"), D("2026-08-02T04:00:00Z")],
      clicks: [
        { createdAt: D("2026-08-01T05:00:00Z"), referrer: "https://www.instagram.com/", userAgent: "iPhone Instagram", ipHash: "a" },
        { createdAt: D("2026-08-02T05:00:00Z"), referrer: null, userAgent: "Windows NT 10.0 Chrome", ipHash: "b" },
        { createdAt: D("2026-08-02T06:00:00Z"), referrer: "https://instagram.com/x", userAgent: "iPhone", ipHash: "c" },
      ],
      failures: ["(#10) blocked", "(#10) blocked", "token expired", null],
    });

    expect(out.funnel).toEqual({
      comments: 10,
      dmsSent: 4,
      clicks: 3,
      uniqueClicks: 3,
      ctr: 75,
      clicksExceedSends: false,
    });
    expect(out.daily).toEqual([
      { date: "2026-08-01", sent: 2, clicks: 1 },
      { date: "2026-08-02", sent: 2, clicks: 2 },
    ]);
    expect(out.referrers).toEqual([
      { referrer: "instagram.com", count: 2 },
      { referrer: "(direct)", count: 1 },
    ]);
    expect(out.devices).toEqual([
      { kind: "mobile", count: 2 },
      { kind: "desktop", count: 1 },
      { kind: "other", count: 0 },
    ]);
    expect(out.failures).toEqual([
      { reason: "(#10) blocked", count: 2 },
      // ties break alphabetically (localeCompare, case-insensitive): t < u
      { reason: "token expired", count: 1 },
      { reason: "Unknown error", count: 1 },
    ]);
  });

  it("empty inputs give zeros, not NaN", () => {
    const out = buildCampaignAnalytics({ dayKeys: ["2026-08-01"], comments: 0, sentAt: [], clicks: [], failures: [] });
    expect(out.funnel).toEqual({
      comments: 0,
      dmsSent: 0,
      clicks: 0,
      uniqueClicks: 0,
      ctr: 0,
      clicksExceedSends: false,
    });
    expect(out.daily).toEqual([{ date: "2026-08-01", sent: 0, clicks: 0 }]);
    expect(out.referrers).toEqual([]);
    expect(out.devices.every((d) => d.count === 0)).toBe(true);
  });
});
