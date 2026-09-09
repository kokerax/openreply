import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    automation: {
      findFirst: vi.fn(),
    },
    dmLog: {
      groupBy: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    linkClick: {
      count: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db/client", () => ({
  prisma: mockPrisma,
}));

import { getCampaignReportBySlug } from "../lib/reports/data";
import { buildReportUrl, isReportBranded } from "../lib/reports/share";

const baseAutomation = {
  id: "automation_123",
  workspaceId: "workspace_123",
  name: "Product Link Drop",
  goal: "Product link request",
  postUrl: "https://instagram.com/p/example",
  keywords: ["LINK", "SHOP"],
  isActive: true,
  createdAt: new Date("2026-05-01T00:00:00.000Z"),
  updatedAt: new Date("2026-05-20T00:00:00.000Z"),
  reportShareSlug: "report_123",
  workspace: {
    name: "Acme Studio",
  },
  instagramAccount: {
    username: "acme",
  },
  trackedLinks: [
    {
      id: "link_123",
      slug: "tracked_123",
      destinationUrl: "https://www.example.com/product",
      _count: { clicks: 12 },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.automation.findFirst.mockResolvedValue(baseAutomation);
  mockPrisma.dmLog.groupBy
    .mockResolvedValueOnce([
      { status: "SENT", _count: { _all: 20 } },
      { status: "FAILED", _count: { _all: 1 } },
      { status: "SKIPPED_RATE_LIMIT", _count: { _all: 2 } },
    ])
    .mockResolvedValueOnce([
      { matchedKeyword: "LINK", _count: { _all: 14 } },
      { matchedKeyword: "SHOP", _count: { _all: 6 } },
    ]);
  mockPrisma.linkClick.count.mockResolvedValue(12);
  mockPrisma.linkClick.groupBy.mockResolvedValue(
    Array.from({ length: 12 }, (_, i) => ({ ipHash: `kisi${i}`, _count: { _all: 1 } }))
  );
  mockPrisma.dmLog.findFirst.mockResolvedValue({
    dmSentAt: new Date("2026-05-20T12:00:00.000Z"),
    createdAt: new Date("2026-05-20T12:00:00.000Z"),
  });
  mockPrisma.dmLog.count.mockResolvedValue(2);
});

describe("campaign reports", () => {
  it("builds an unbranded report without private log data", async () => {
    const report = await getCampaignReportBySlug("report_123");

    expect(report).toMatchObject({
      shareSlug: "report_123",
      branded: false,
      workspace: { name: "Acme Studio" },
      campaign: {
        name: "Product Link Drop",
        instagramUsername: "acme",
      },
      metrics: {
        sent: 20,
        skipped: 2,
        failed: 1,
        clicks: 12,
        ctr: 60,
      },
      topKeywords: [
        { keyword: "LINK", count: 14 },
        { keyword: "SHOP", count: 6 },
      ],
      trackedLinks: [
        {
          destinationHost: "example.com",
          clicks: 12,
        },
      ],
    });
    expect(report?.daily).toHaveLength(7);
    expect("dmMessage" in (report?.campaign ?? {})).toBe(false);
  });

  it("MUSTERIYE giden rapor sentetik defter satirlarini SAYMAZ", async () => {
    // Bu rapor musteriye paylasilan baglantiyla gidiyor — ayni "yanlis
    // evreni say" hatasinin en yuksek bedelli kopyasi. Panelde CTR'i
    // %28,7 gosteren hata burada da duruyordu.
    mockPrisma.automation.findFirst.mockResolvedValue(baseAutomation);
    mockPrisma.dmLog.groupBy.mockReset();
    mockPrisma.dmLog.groupBy.mockResolvedValue([]);
    mockPrisma.dmLog.findFirst.mockResolvedValue(null);
    mockPrisma.dmLog.count.mockResolvedValue(0);
    mockPrisma.linkClick.count.mockResolvedValue(0);
    mockPrisma.linkClick.groupBy.mockResolvedValue([]);

    await getCampaignReportBySlug("report_123");

    const durumSorgusu = mockPrisma.dmLog.groupBy.mock.calls
      .map((c) => c[0])
      .find((a) => a.by.includes("status"));
    expect(durumSorgusu.where.isBackfill).toBe(false);
    expect(durumSorgusu.where.commentId).toEqual({ not: { contains: ":" } });

    // Gunluk seri de ayni evrenden — yoksa toplam ile grafik celisirdi.
    for (const cagri of mockPrisma.dmLog.count.mock.calls) {
      expect(cagri[0].where.commentId).toEqual({ not: { contains: ":" } });
    }
  });

  it("rapor CTR'i TEKIL tiklayandan hesaplanir", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue(baseAutomation);
    // `beforeEach`'teki `mockResolvedValueOnce` kuyrugu implementasyondan
    // ONCE tuketiliyor; sifirlamazsak bu test onun sayilarini olcer.
    mockPrisma.dmLog.groupBy.mockReset();
    mockPrisma.dmLog.groupBy.mockImplementation(async (a: { by: string[] }) =>
      a.by.includes("status") ? [{ status: "SENT", _count: { _all: 10 } }] : []
    );
    mockPrisma.dmLog.findFirst.mockResolvedValue(null);
    mockPrisma.dmLog.count.mockResolvedValue(0);
    // 5 tiklama ama 2 kisi.
    mockPrisma.linkClick.groupBy.mockResolvedValue([
      { ipHash: "a", _count: { _all: 4 } },
      { ipHash: "b", _count: { _all: 1 } },
    ]);

    const rapor = await getCampaignReportBySlug("report_123");

    expect(rapor!.metrics.clicks).toBe(5);
    expect(rapor!.metrics.uniqueClicks).toBe(2);
    // 2/10 = %20; toplamla %50 derdi.
    expect(rapor!.metrics.ctr).toBe(20);
  });

  it("returns null when a report slug is missing or disabled", async () => {
    mockPrisma.automation.findFirst.mockResolvedValueOnce(null);

    await expect(getCampaignReportBySlug("missing")).resolves.toBeNull();
  });

  it("builds report URLs and branding flags", () => {
    expect(buildReportUrl("abc123", "https://manychat-alternative.com/")).toBe(
      "https://manychat-alternative.com/reports/abc123"
    );
    expect(isReportBranded()).toBe(false);
  });
});
