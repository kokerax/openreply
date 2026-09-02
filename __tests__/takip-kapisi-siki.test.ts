/**
 * Takip kapisi SIKI olmali: `false` VE `null` (durum okunamadi) link ALMAZ.
 * 2026-09-02 oncesi postback yolu fail-open'di — null gecip linki aliyordu.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, sendDirectMessageWithButton, sendDirectMessageWithLinkButton, sendDirectMessage, getUserFollowStatus, reserveDMSlot, queueAdd } = vi.hoisted(() => ({
  mockPrisma: {
    automation: { findMany: vi.fn(), findFirst: vi.fn() },
    dmLog: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn(), create: vi.fn() },
    lead: { findUnique: vi.fn(), upsert: vi.fn() },
    instagramAccount: { findUnique: vi.fn() },
    operationalEvent: { create: vi.fn() },
  },
  sendDirectMessageWithButton: vi.fn(), sendDirectMessageWithLinkButton: vi.fn(), sendDirectMessage: vi.fn(),
  getUserFollowStatus: vi.fn(), reserveDMSlot: vi.fn(), queueAdd: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/client", () => ({
  sendPrivateReply: vi.fn(), sendPrivateReplyWithButton: vi.fn(), sendPrivateReplyWithLinkButton: vi.fn(),
  sendDirectMessage, sendDirectMessageWithButton, sendDirectMessageWithLinkButton,
  getUserFollowStatus, sendCommentReply: vi.fn(),
  MetaApiError: class extends Error { code = 0; }, TokenExpiredError: class extends Error {}, RateLimitError: class extends Error {},
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: () => "tok" }));
vi.mock("@/lib/utils/pg-rate-limiter", () => ({ reserveDMSlot }));
vi.mock("@/lib/billing/usage", () => ({
  reserveWorkspaceDMSend: vi.fn(async () => ({ allowed: true, reserved: true, remaining: 9, limit: 2000, periodStart: new Date() })),
  releaseWorkspaceDMReservation: vi.fn(async () => ({ count: 1 })),
}));
vi.mock("@/lib/ops/worker-health", () => ({ recordWorkerAlert: vi.fn() }));
vi.mock("@/lib/queue/client", () => ({ getDMQueue: () => ({ add: queueAdd }), getRedisConnection: vi.fn(), POSTBACK_JOB_NAME: "process-postback", FOLLOWUP_JOB_NAME: "process-followup", MESSAGE_JOB_NAME: "process-message" }));

import { processJob } from "../lib/queue/dm-worker";

const IG = "17841465942418709";
const kampanya = {
  id: "a1", workspaceId: "ws1", instagramAccountId: "iga1", name: "Test",
  keywords: ["gta"], matchAnyWord: false, wholeWordMatch: false, matchAnyPost: true,
  dmMessage: "link:", linkButtonLabel: "GİT", requireFollow: true,
  followPromptMessage: "önce takip et", followPromptButtonLabel: "Following",
  followUpEnabled: false, followUpMessage: null, followUpDelayMinutes: 0,
  emailGateEnabled: false, publicReplyEnabled: false, isActive: true,
  instagramAccount: { id: "iga1", instagramId: IG, accessToken: "enc" }, workspace: { id: "ws1" },
  trackedLinks: [{ slug: "s1", label: "GİT", destinationUrl: "https://ornek.com/x" }],
};
const dokunus = () => ({ name: "process-postback", id: "p1", attemptsMade: 0, data: { instagramAccountId: IG, userId: "u1", payload: "followcheck:a1", fallback: false } });

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.automation.findFirst.mockResolvedValue(kampanya);
  mockPrisma.automation.findMany.mockResolvedValue([]);
  mockPrisma.dmLog.findUnique.mockResolvedValue(null);
  mockPrisma.dmLog.findFirst.mockResolvedValue({ commenterName: "ali" });
  mockPrisma.dmLog.upsert.mockResolvedValue({ attempts: 1 });
  mockPrisma.dmLog.update.mockResolvedValue({}); mockPrisma.dmLog.create.mockResolvedValue({});
  mockPrisma.lead.findUnique.mockResolvedValue(null);
  mockPrisma.operationalEvent.create.mockResolvedValue({});
  reserveDMSlot.mockResolvedValue({ allowed: true, currentCount: 1, remainingDMs: 7, shouldRequeue: false, requeueDelayMs: 0, shouldSkip: false, reserved: true });
  for (const f of [sendDirectMessage, sendDirectMessageWithButton, sendDirectMessageWithLinkButton]) f.mockResolvedValue({ message_id: "m" });
});

describe("takip kapısı — fail-closed", () => {
  it("durum OKUNAMIYOR (null) → link GİTMEZ, takip istemi gider", async () => {
    getUserFollowStatus.mockResolvedValue(null);
    await processJob(dokunus() as never);
    expect(sendDirectMessageWithLinkButton).not.toHaveBeenCalled();
    expect(sendDirectMessageWithButton).toHaveBeenCalledTimes(1);
    expect(sendDirectMessageWithButton.mock.calls[0][4]).toBe("Following");
  });

  it("takip ETMİYOR (false) → link GİTMEZ", async () => {
    getUserFollowStatus.mockResolvedValue(false);
    await processJob(dokunus() as never);
    expect(sendDirectMessageWithLinkButton).not.toHaveBeenCalled();
  });

  it("takip EDİYOR (true) → link gider (kontrol çifti: kapı her şeyi engellemiyor)", async () => {
    getUserFollowStatus.mockResolvedValue(true);
    await processJob(dokunus() as never);
    expect(sendDirectMessageWithLinkButton).toHaveBeenCalledTimes(1);
    const b = sendDirectMessageWithLinkButton.mock.calls[0].at(-1) as Array<{ url: string }>;
    expect(b[0].url).toMatch(/\/r\/s1$/);
  });

  it("okuma-fallback'inde durum okunamıyorsa sessizce atlanır (bekleyerek kapı aşılamaz)", async () => {
    getUserFollowStatus.mockResolvedValue(null);
    await processJob({ ...dokunus(), data: { ...dokunus().data, payload: "reveal:a1", fallback: true } } as never);
    expect(sendDirectMessageWithLinkButton).not.toHaveBeenCalled();
    expect(sendDirectMessageWithButton).not.toHaveBeenCalled();
  });

  it("sınırı aşan tekrar: 4. denemede istem DURUR ve Diagnostics'e uyarı yazılır", async () => {
    getUserFollowStatus.mockResolvedValue(null);
    mockPrisma.dmLog.upsert.mockResolvedValue({ attempts: 4 });
    await processJob(dokunus() as never);
    expect(sendDirectMessageWithButton).not.toHaveBeenCalled();
    expect(mockPrisma.operationalEvent.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.operationalEvent.create.mock.calls[0][0].data.message).toContain("Takip kapisi");
  });

  it("sınır içindeyken (3. deneme) istem hâlâ gider", async () => {
    getUserFollowStatus.mockResolvedValue(null);
    mockPrisma.dmLog.upsert.mockResolvedValue({ attempts: 3 });
    await processJob(dokunus() as never);
    expect(sendDirectMessageWithButton).toHaveBeenCalledTimes(1);
    expect(mockPrisma.operationalEvent.create).not.toHaveBeenCalled();
  });
});
