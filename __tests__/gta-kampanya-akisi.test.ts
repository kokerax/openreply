/**
 * GTA VI Prompt kampanyasi — GERCEK kampanya kaydi (DB'den alinmis fixture) ile
 * uretim worker'ini uctan uca kosturur; yalnizca Meta API ve DB mock'lanir.
 * Anahtar kelime eslestiricisi GERCEK (mock degil).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import gta from "./fixtures/gta-automation.json";

const {
  mockPrisma, sendPrivateReplyWithButton, sendPrivateReplyWithLinkButton, sendPrivateReply,
  getUserFollowStatus, sendDirectMessageWithButton, sendDirectMessageWithLinkButton, sendDirectMessage, queueAdd,
} = vi.hoisted(() => ({
  mockPrisma: {
    automation: { findMany: vi.fn(), findFirst: vi.fn() },
    dmLog: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn(), create: vi.fn() },
    lead: { findUnique: vi.fn(), upsert: vi.fn() },
    instagramAccount: { findUnique: vi.fn() },
    operationalEvent: { create: vi.fn() },
  },
  sendPrivateReplyWithButton: vi.fn(), sendPrivateReplyWithLinkButton: vi.fn(), sendPrivateReply: vi.fn(),
  getUserFollowStatus: vi.fn(), sendDirectMessageWithButton: vi.fn(), sendDirectMessageWithLinkButton: vi.fn(),
  sendDirectMessage: vi.fn(), queueAdd: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/client", () => ({
  sendPrivateReply, sendPrivateReplyWithLinkButton, sendPrivateReplyWithButton, getUserFollowStatus,
  sendDirectMessageWithButton, sendDirectMessage, sendDirectMessageWithLinkButton, sendCommentReply: vi.fn(),
  MetaApiError: class extends Error { code = 0; }, TokenExpiredError: class extends Error {}, RateLimitError: class extends Error {},
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: () => "tok" }));
vi.mock("@/lib/utils/pg-rate-limiter", () => ({ reserveDMSlot: vi.fn(async () => ({ allowed: true, currentCount: 1, remainingDMs: 7, shouldRequeue: false, requeueDelayMs: 0, shouldSkip: false, reserved: true })) }));
vi.mock("@/lib/billing/usage", () => ({ reserveWorkspaceDMSend: vi.fn(async () => ({ allowed: true, reserved: true, remaining: 100, limit: 2000, periodStart: new Date() })), releaseWorkspaceDMReservation: vi.fn(async () => ({ count: 1 })) }));
vi.mock("@/lib/ops/worker-health", () => ({ recordWorkerAlert: vi.fn() }));
vi.mock("@/lib/queue/client", () => ({ getDMQueue: () => ({ add: queueAdd }), getRedisConnection: vi.fn(), POSTBACK_JOB_NAME: "process-postback", FOLLOWUP_JOB_NAME: "process-followup", MESSAGE_JOB_NAME: "process-message" }));

import { processJob } from "../lib/queue/dm-worker";

const IG = gta.instagramAccount.instagramId;
const yorum = (text: string) => ({ id: "j1", attemptsMade: 0, data: { instagramAccountId: IG, commentId: "c_gta_1", commentText: text, commenterId: "u_777", commenterName: "ali_test", mediaId: "media_foto_1" } });
const mesaj = (text: string) => ({ name: "process-message", id: "m1", attemptsMade: 0, data: { instagramAccountId: IG, messageId: "msg_gta_1", messageText: text, senderId: "u_777" } });
const postback = () => ({ name: "process-postback", id: "p1", attemptsMade: 0, data: { instagramAccountId: IG, userId: "u_777", payload: `followcheck:${gta.id}` } });

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.automation.findMany.mockResolvedValue([gta]);
  mockPrisma.automation.findFirst.mockResolvedValue(gta);
  mockPrisma.dmLog.findUnique.mockResolvedValue(null);
  mockPrisma.dmLog.findFirst.mockImplementation(async (a: { where?: { status?: string } } = {}) => (a.where?.status === "SENT" ? null : { commenterName: "ali_test" }));
  mockPrisma.dmLog.create.mockResolvedValue({}); mockPrisma.dmLog.upsert.mockResolvedValue({ attempts: 1 }); mockPrisma.dmLog.update.mockResolvedValue({});
  mockPrisma.lead.findUnique.mockResolvedValue(null); mockPrisma.lead.upsert.mockResolvedValue({});
  mockPrisma.instagramAccount.findUnique.mockResolvedValue({ workspaceId: gta.workspaceId });
  mockPrisma.operationalEvent.create.mockResolvedValue({});
  for (const f of [sendPrivateReply, sendPrivateReplyWithLinkButton, sendPrivateReplyWithButton, sendDirectMessageWithButton, sendDirectMessageWithLinkButton, sendDirectMessage]) f.mockResolvedValue({ recipient_id: "u_777", message_id: "m1" });
  getUserFollowStatus.mockResolvedValue(true);
});

describe("GTA VI Prompt kampanyasi — uctan uca (gercek kayit, gercek eslestirici)", () => {
  it("'GTA yaz' yorumu → once E-POSTA istenir (link/acilis DM'i GITMEZ)", async () => {
    await processJob(yorum("GTA yaz") as never);
    expect(sendPrivateReply).toHaveBeenCalledTimes(1);
    expect(sendPrivateReply.mock.calls[0][3]).toContain("e-posta adresini");
    expect(sendPrivateReplyWithButton).not.toHaveBeenCalled();
    expect(sendPrivateReplyWithLinkButton).not.toHaveBeenCalled();
    const kapi = mockPrisma.dmLog.upsert.mock.calls.find((c: any[]) => String(c[0].create?.commentId).startsWith("emailgate:"));
    expect(kapi, "bekleme kaydi yazilmali").toBeTruthy();
  });

  it("kisi adresini yazinca Lead kaydedilir ve GERCEK prompt linki gider", async () => {
    mockPrisma.dmLog.findUnique.mockImplementation(async (a: any) =>
      String(a?.where?.automationId_commentId?.commentId).startsWith("emailgate:")
        ? { id: "gate1", commenterName: "ali_test", attempts: 0, status: "PENDING" }
        : null);
    getUserFollowStatus.mockResolvedValue(true);
    await processJob(mesaj("ali@example.com") as never);
    expect(mockPrisma.lead.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.lead.upsert.mock.calls[0][0].create.email).toBe("ali@example.com");
    const linkCalls = [...sendDirectMessageWithLinkButton.mock.calls, ...sendPrivateReplyWithLinkButton.mock.calls];
    expect(linkCalls.length).toBe(1);
    const buttons = linkCalls[0][linkCalls[0].length - 1] as Array<{ title: string; url: string }>;
    expect(buttons[0].title).toBe("PROMPTA GİT");
    expect(buttons[0].url).toMatch(new RegExp(`/r/${gta.trackedLinks[0].slug}$`));
    // Izlenen link GERCEK hedefe gitmeli (canli /r/<slug> yonlendirmesi).
    expect(gta.trackedLinks[0].destinationUrl).toBe("https://www.yapayzekakademisi.com/promptlar/#gta");
  });

  it("adresini vermis kisinin buton dokunusu + takipci → linkli DM, PROMPTA GİT butonu /r/gta-… izlenen linke gider", async () => {
    getUserFollowStatus.mockResolvedValue(true);
    mockPrisma.lead.findUnique.mockResolvedValue({ id: "lead1" });
    await processJob(postback() as never);
    const linkCalls = [...sendDirectMessageWithLinkButton.mock.calls, ...sendPrivateReplyWithLinkButton.mock.calls];
    expect(linkCalls.length).toBe(1);
    const call = linkCalls[0]; const buttons = call[call.length - 1] as Array<{ title: string; url: string }>;
    expect(buttons[0].title).toBe("PROMPTA GİT");
    expect(buttons[0].url).toMatch(new RegExp(`/r/${gta.trackedLinks[0].slug}$`));
    expect(String(call[3])).toContain("GTA VI görselinin prompt'u");
  });
  it("buton dokunusu + takipci DEGIL → takip istemi (Following butonu), link GONDERILMEZ", async () => {
    getUserFollowStatus.mockResolvedValue(false);
    await processJob(postback() as never);
    expect(sendDirectMessageWithLinkButton).not.toHaveBeenCalled();
    expect(sendPrivateReplyWithLinkButton).not.toHaveBeenCalled();
    expect(sendDirectMessageWithButton).toHaveBeenCalledTimes(1);
    expect(sendDirectMessageWithButton.mock.calls[0][4]).toBe("Following");
  });
  it("'harika görsel' yorumu → hicbir sey gonderilmez (kontrol cifti)", async () => {
    await processJob(yorum("harika görsel 😍") as never);
    for (const f of [sendPrivateReply, sendPrivateReplyWithLinkButton, sendPrivateReplyWithButton, sendDirectMessageWithButton, sendDirectMessageWithLinkButton]) expect(f).not.toHaveBeenCalled();
  });
});
