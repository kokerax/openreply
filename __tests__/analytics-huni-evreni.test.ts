/**
 * Kampanya huni ucu — DORT sorgunun DORDU de ayni evrenden.
 *
 * `comments`, `sentRows` ve tiklamalar `yorumKapsami`'na tasinmisti ama
 * `failedRows` `dmScope`'ta kalmisti. Sonuc: kampanya LISTESI (filtreli)
 * "0 failed" derken kampanya DETAY huni ekrani sentetik defter satirlarinin
 * hatalarini sayiyordu — ayni kampanya iki ekranda farkli gorunuyordu.
 *
 * Bu test rotayi CAGIRIYOR; kaynakta kelime aramiyor, cunku oyle bir assert
 * import satiri ya da yorum ile eslesip kendi mutasyonunu gecebiliyor.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockContext } = vi.hoisted(() => ({
  mockPrisma: {
    automation: { findFirst: vi.fn() },
    dmLog: { count: vi.fn(), findMany: vi.fn() },
    linkClick: { findMany: vi.fn() },
  },
  mockContext: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId: vi.fn(async () => "ws_1") }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mockContext,
  canManageWorkspace: () => true,
}));

import { NextRequest } from "next/server";
import { GET } from "../app/api/automations/[id]/analytics/route";

/** Yorum evreni: `commentId` icinde iki nokta OLMAYAN satirlar. */
const YORUM_FILTRESI = { not: { contains: ":" } };

async function cagir() {
  return GET(
    new NextRequest("http://localhost/api/automations/a1/analytics?from=2026-08-01&to=2026-09-01"),
    { params: Promise.resolve({ id: "a1" }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockContext.mockResolvedValue({ workspaceId: "ws_1", role: "OWNER" });
  mockPrisma.automation.findFirst.mockResolvedValue({
    id: "a1",
    name: "Test",
    workspaceId: "ws_1",
    createdAt: new Date("2026-08-01T00:00:00Z"),
  });
  mockPrisma.dmLog.count.mockResolvedValue(0);
  mockPrisma.dmLog.findMany.mockResolvedValue([]);
  mockPrisma.linkClick.findMany.mockResolvedValue([]);
});

describe("huninin her adimi ayni evrenden", () => {
  it("HATA dokumu de yalnizca gercek yorumlari sayar", async () => {
    await cagir();

    const failed = mockPrisma.dmLog.findMany.mock.calls
      .map((c) => c[0])
      .find((a) => a?.where?.status === "FAILED");

    expect(failed, "FAILED sorgusu hic yapilmadi").toBeTruthy();
    expect(failed.where.commentId).toEqual(YORUM_FILTRESI);
    expect(failed.where.isBackfill).toBe(false);
  });

  it("yorum sayimi ve SENT sorgusu da ayni filtreyi tasir", async () => {
    await cagir();

    const sayim = mockPrisma.dmLog.count.mock.calls[0][0];
    expect(sayim.where.commentId).toEqual(YORUM_FILTRESI);

    const sent = mockPrisma.dmLog.findMany.mock.calls
      .map((c) => c[0])
      .find((a) => a?.where?.status === "SENT");
    expect(sent.where.commentId).toEqual(YORUM_FILTRESI);
  });

  it("DORT sorgunun tamami ayni kampanya ve araliga bagli", async () => {
    // Bolumleme kontrolu: bir sorgu farkli bir kampanyayi ya da araligi
    // olcerse huni kendi icinde celisir.
    await cagir();

    const hepsi = [
      ...mockPrisma.dmLog.count.mock.calls.map((c) => c[0]),
      ...mockPrisma.dmLog.findMany.mock.calls.map((c) => c[0]),
      ...mockPrisma.linkClick.findMany.mock.calls.map((c) => c[0]),
    ];
    expect(hepsi.length).toBe(4);
    for (const a of hepsi) {
      expect(a.where.automationId).toBe("a1");
      expect(a.where.workspaceId).toBe("ws_1");
      expect(a.where.createdAt).toBeTruthy();
    }
  });
});
