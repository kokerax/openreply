/**
 * /api/automations GET — kampanya listesi ayni evreni saymali.
 *
 * Ayni "yanlis evreni say" hatasi bu oturumda DORDUNCU kez ortaya cikti:
 * once yorum cevabi kurtarmasinda, sonra dashboard kartinda, sonra kampanya
 * hunisinde, simdi de kampanya LISTESINDE. Liste `runs` ve `sent` sayarken
 * sentetik defter satirlarini (reveal:/emailgate:) da sayiyordu:
 *
 *   GTA VI Prompt : 305 runs / 244 sent -> gercegi 122 / 116, CTR %28,7 -> %53,4
 *   CITY Sehir    :  39 runs /  31 sent -> gercegi  15 /  15, CTR %45,2 -> %60,0
 *
 * Ayrica CTR payi TOPLAM tiklamaydi: bir kisinin iki tiklamasi iki donusum
 * sayiliyordu.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockContext, mockWorkspaceId } = vi.hoisted(() => ({
  mockPrisma: {
    automation: { findMany: vi.fn(), update: vi.fn() },
    dmLog: { groupBy: vi.fn() },
    linkClick: { groupBy: vi.fn() },
  },
  mockContext: vi.fn(),
  mockWorkspaceId: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId: mockWorkspaceId }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mockContext,
  canManageWorkspace: () => true,
}));

import { NextRequest } from "next/server";
import { GET } from "../app/api/automations/route";

function kampanya(id: string, ad: string, calisma: number) {
  return {
    id,
    name: ad,
    workspaceId: "ws_1",
    reportShareSlug: "slug-" + id,
    isActive: true,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    instagramAccount: { username: "acct", instagramId: "ig_1" },
    _count: { dmLogs: calisma },
    trackedLinks: [],
  };
}

async function listeyiAl() {
  const res = await GET(new NextRequest("http://localhost/api/automations"));
  const body = await res.json();
  return (body.data as Array<{ analytics: Record<string, number> }>).map(
    (a) => a.analytics
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockContext.mockResolvedValue({ workspaceId: "ws_1", role: "OWNER" });
  mockWorkspaceId.mockResolvedValue("ws_1");
  mockPrisma.automation.findMany.mockResolvedValue([kampanya("a1", "GTA", 122)]);
  mockPrisma.dmLog.groupBy.mockResolvedValue([]);
  mockPrisma.linkClick.groupBy.mockResolvedValue([]);
});

describe("sayimlar sentetik defter satirlarini ELEMELI", () => {
  it("runs sayisi yalnizca gercek yorumlari sayar", async () => {
    await listeyiAl();

    const cagri = mockPrisma.automation.findMany.mock.calls[0][0];
    const runsFiltresi = cagri.include._count.select.dmLogs.where;
    expect(runsFiltresi.isBackfill).toBe(false);
    expect(runsFiltresi.commentId).toEqual({ not: { contains: ":" } });
  });

  it("sent/failed/skipped sorgusu da yalnizca yorumlari sayar", async () => {
    await listeyiAl();

    const durumSorgusu = mockPrisma.dmLog.groupBy.mock.calls
      .map((c) => c[0])
      .find((a) => a.by.includes("status"));
    expect(durumSorgusu.where.isBackfill).toBe(false);
    expect(durumSorgusu.where.commentId).toEqual({ not: { contains: ":" } });
  });
});

describe("CTR tekil tiklayandan hesaplanir", () => {
  it("ayni kisinin iki tiklamasi IKI donusum sayilmaz", async () => {
    mockPrisma.dmLog.groupBy.mockImplementation(async (a: { by: string[] }) =>
      a.by.includes("status")
        ? [{ automationId: "a1", status: "SENT", _count: { _all: 10 } }]
        : []
    );
    // 5 tiklama ama 2 tekil kisi.
    mockPrisma.linkClick.groupBy.mockResolvedValue([
      { automationId: "a1", ipHash: "kisi-a", _count: { _all: 4 } },
      { automationId: "a1", ipHash: "kisi-b", _count: { _all: 1 } },
    ]);

    const liste = await listeyiAl();

    expect(liste[0].clicks).toBe(5);
    expect(liste[0].uniqueClicks).toBe(2);
    // 2/10 = %20. Toplamla hesaplasaydi %50 derdi.
    expect(liste[0].ctr).toBe(20);
  });

  it("ipHash'i OLMAYAN eski tiklamalar teker teker sayilir", async () => {
    mockPrisma.dmLog.groupBy.mockImplementation(async (a: { by: string[] }) =>
      a.by.includes("status")
        ? [{ automationId: "a1", status: "SENT", _count: { _all: 10 } }]
        : []
    );
    mockPrisma.linkClick.groupBy.mockResolvedValue([
      { automationId: "a1", ipHash: null, _count: { _all: 3 } },
      { automationId: "a1", ipHash: "kisi-a", _count: { _all: 2 } },
    ]);

    const liste = await listeyiAl();

    // 3 kimliksiz + 1 tekil = 4. Hepsini "bir kisi" saymak donusumu gizlerdi.
    expect(liste[0].uniqueClicks).toBe(4);
    expect(liste[0].clicks).toBe(5);
  });

  it("KARSI YON: her tiklama ayri kisiyse CTR degismez", async () => {
    mockPrisma.dmLog.groupBy.mockImplementation(async (a: { by: string[] }) =>
      a.by.includes("status")
        ? [{ automationId: "a1", status: "SENT", _count: { _all: 4 } }]
        : []
    );
    mockPrisma.linkClick.groupBy.mockResolvedValue([
      { automationId: "a1", ipHash: "x", _count: { _all: 1 } },
      { automationId: "a1", ipHash: "y", _count: { _all: 1 } },
    ]);

    const liste = await listeyiAl();

    expect(liste[0].uniqueClicks).toBe(2);
    expect(liste[0].ctr).toBe(50);
  });
});
