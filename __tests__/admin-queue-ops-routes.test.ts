/**
 * /api/admin/queue/[id] ve /api/admin/ops/[id] — yetki + sahiplik.
 * Auth ve prisma mock'lanir; pg-queue'nun SAF yardimcilari gercek kalir
 * (sahiplik karari onlarda), DB'ye dokunanlar mock'lanir.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCtx, mockPrisma, mockQueue } = vi.hoisted(() => ({
  mockCtx: vi.fn(),
  mockPrisma: {
    instagramAccount: { findMany: vi.fn() },
    operationalEvent: { findFirst: vi.fn(), update: vi.fn() },
  },
  mockQueue: {
    isiGetir: vi.fn(),
    isiSil: vi.fn(),
    isiYenidenKuyrukla: vi.fn(),
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
// Tamamen mock: orijinali next-auth'u (ve onun `next/server` cozumlemesini)
// surukler. canManageWorkspace'in gercek kurali ADMIN+ — burada aynen.
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mockCtx,
  canManageWorkspace: (role: string) => role === "ADMIN" || role === "OWNER",
}));
vi.mock("@/lib/queue/pg-queue", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/queue/pg-queue")>();
  return { ...orig, ...mockQueue };
});

import { NextRequest } from "next/server";
import { POST as retryJob, DELETE as purgeJob } from "@/app/api/admin/queue/[id]/route";
import { POST as resolveEvent } from "@/app/api/admin/ops/[id]/route";

const req = () => new NextRequest("http://localhost/api/admin/x");
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const admin = { userId: "u1", workspaceId: "ws1", role: "ADMIN", workspace: {} };

beforeEach(() => {
  vi.clearAllMocks();
  mockCtx.mockResolvedValue(admin);
  mockPrisma.instagramAccount.findMany.mockResolvedValue([{ id: "acc_a" }]);
});

describe("POST /api/admin/queue/[id] (retry)", () => {
  it("401 without a session", async () => {
    mockCtx.mockResolvedValue(null);
    const res = await retryJob(req(), params("j1"));
    expect(res.status).toBe(401);
    expect(mockQueue.isiYenidenKuyrukla).not.toHaveBeenCalled();
  });

  it("403 for a plain MEMBER", async () => {
    mockCtx.mockResolvedValue({ ...admin, role: "MEMBER" });
    const res = await retryJob(req(), params("j1"));
    expect(res.status).toBe(403);
    expect(mockQueue.isiYenidenKuyrukla).not.toHaveBeenCalled();
  });

  it("404 when the job belongs to another workspace's account", async () => {
    mockQueue.isiGetir.mockResolvedValue({ id: "j1", data: { instagramAccountId: "acc_other" } });
    const res = await retryJob(req(), params("j1"));
    expect(res.status).toBe(404);
    expect(mockQueue.isiYenidenKuyrukla).not.toHaveBeenCalled();
  });

  it("404 when the job has no account id at all", async () => {
    mockQueue.isiGetir.mockResolvedValue({ id: "j1", data: {} });
    const res = await retryJob(req(), params("j1"));
    expect(res.status).toBe(404);
  });

  it("200 and re-queues an owned job", async () => {
    mockQueue.isiGetir.mockResolvedValue({ id: "j1", data: { instagramAccountId: "acc_a" } });
    mockQueue.isiYenidenKuyrukla.mockResolvedValue(undefined);
    const res = await retryJob(req(), params("j1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { id: "j1", status: "PENDING" } });
    expect(mockQueue.isiYenidenKuyrukla).toHaveBeenCalledWith("j1", expect.any(Date));
  });
});

describe("DELETE /api/admin/queue/[id] (purge)", () => {
  it("deletes an owned job", async () => {
    mockQueue.isiGetir.mockResolvedValue({ id: "j1", data: { instagramAccountId: "acc_a" } });
    mockQueue.isiSil.mockResolvedValue(undefined);
    const res = await purgeJob(req(), params("j1"));
    expect(res.status).toBe(200);
    expect(mockQueue.isiSil).toHaveBeenCalledWith("j1");
  });

  it("refuses a foreign job", async () => {
    mockQueue.isiGetir.mockResolvedValue({ id: "j1", data: { instagramAccountId: "acc_other" } });
    const res = await purgeJob(req(), params("j1"));
    expect(res.status).toBe(404);
    expect(mockQueue.isiSil).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/ops/[id] (resolve)", () => {
  it("scopes the lookup to this workspace OR system-wide (null) events", async () => {
    mockPrisma.operationalEvent.findFirst.mockResolvedValue({ id: "e1", resolvedAt: null });
    mockPrisma.operationalEvent.update.mockResolvedValue({});
    const res = await resolveEvent(req(), params("e1"));
    expect(res.status).toBe(200);
    const where = mockPrisma.operationalEvent.findFirst.mock.calls[0][0].where;
    expect(where).toEqual({ id: "e1", OR: [{ workspaceId: "ws1" }, { workspaceId: null }] });
    const data = mockPrisma.operationalEvent.update.mock.calls[0][0].data;
    expect(data.resolvedAt).toBeInstanceOf(Date);
  });

  it("404 when the event is not visible to this workspace", async () => {
    mockPrisma.operationalEvent.findFirst.mockResolvedValue(null);
    const res = await resolveEvent(req(), params("e1"));
    expect(res.status).toBe(404);
    expect(mockPrisma.operationalEvent.update).not.toHaveBeenCalled();
  });

  it("is idempotent: an already-resolved event keeps its original stamp", async () => {
    const eski = new Date("2026-01-01T00:00:00.000Z");
    mockPrisma.operationalEvent.findFirst.mockResolvedValue({ id: "e1", resolvedAt: eski });
    const res = await resolveEvent(req(), params("e1"));
    expect(res.status).toBe(200);
    expect(mockPrisma.operationalEvent.update).not.toHaveBeenCalled();
    expect((await res.json()).data.resolvedAt).toBe(eski.toISOString());
  });

  it("403 for a plain MEMBER", async () => {
    mockCtx.mockResolvedValue({ ...admin, role: "MEMBER" });
    const res = await resolveEvent(req(), params("e1"));
    expect(res.status).toBe(403);
  });
});
