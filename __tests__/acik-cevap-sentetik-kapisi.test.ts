/**
 * Acik yorum cevabi YALNIZCA gercek yorumlara gonderilir.
 *
 * Canli hata (2026-09-08 17:37):
 *   Meta API Error 100: Unsupported post request. Object with ID
 *   'dm:aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQx...' does not exist
 *
 * Yani sistem bir DEFTER SATIRININ sentetik anahtarina yorum cevabi
 * yazmaya calisti. Kok neden yorum-cevabi kurtarmasinin defter satirlarini
 * kuyruklamasiydi ve o duzeltildi (duzeltmeden sonra 0 olay). Bu test
 * kuyruk ne gonderirse gondersin GONDERIM ANINDA kapiyi tutuyor:
 * `SADECE_YORUM` sayim yollarini koruyor, burasi YAZMA yolunu.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockPrisma,
  sendPrivateReply,
  sendCommentReply,
  reserveDMSlot,
} = vi.hoisted(() => ({
  mockPrisma: {
    automation: { findMany: vi.fn(), findFirst: vi.fn() },
    dmLog: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    lead: { findUnique: vi.fn(), upsert: vi.fn() },
    instagramAccount: { findUnique: vi.fn() },
    operationalEvent: { create: vi.fn() },
  },
  sendPrivateReply: vi.fn(),
  sendCommentReply: vi.fn(),
  reserveDMSlot: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/client", () => ({
  sendPrivateReply,
  sendPrivateReplyWithButton: vi.fn(),
  sendPrivateReplyWithLinkButton: vi.fn(),
  sendDirectMessage: vi.fn(),
  sendDirectMessageWithButton: vi.fn(),
  sendDirectMessageWithLinkButton: vi.fn(),
  getUserFollowStatus: vi.fn(),
  sendCommentReply,
  MetaApiError: class extends Error {
    code = 0;
  },
  TokenExpiredError: class extends Error {},
  RateLimitError: class extends Error {},
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: () => "tok" }));
vi.mock("@/lib/utils/pg-rate-limiter", () => ({ reserveDMSlot }));
vi.mock("@/lib/billing/usage", () => ({
  reserveWorkspaceDMSend: vi.fn(async () => ({
    allowed: true,
    reserved: true,
    remaining: 9,
    limit: 2000,
    periodStart: new Date(),
  })),
  releaseWorkspaceDMReservation: vi.fn(async () => ({ count: 1 })),
}));
vi.mock("@/lib/ops/worker-health", () => ({ recordWorkerAlert: vi.fn() }));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: vi.fn() }),
  getRedisConnection: vi.fn(),
  POSTBACK_JOB_NAME: "process-postback",
  FOLLOWUP_JOB_NAME: "process-followup",
  MESSAGE_JOB_NAME: "process-message",
}));

import { processJob } from "../lib/queue/dm-worker";

const IG = "17841465942418709";

const kampanya = {
  id: "a1",
  workspaceId: "ws1",
  instagramAccountId: "iga1",
  name: "Test",
  keywords: ["gta"],
  matchAnyWord: true,
  wholeWordMatch: false,
  matchAnyPost: true,
  dmMessage: "link:",
  linkButtonLabel: null,
  requireFollow: false,
  followPromptMessage: null,
  followPromptButtonLabel: null,
  followUpEnabled: false,
  followUpMessage: null,
  followUpDelayMinutes: 0,
  emailGateEnabled: false,
  openingDmMessage: null,
  openingDmButtonLabel: null,
  // Acik cevap ACIK: kapi olmasaydi her isde denenirdi.
  publicReplyEnabled: true,
  publicReplyMessages: ["Yolladim! DM kutuna bak"],
  publicReplyMessage: null,
  isActive: true,
  instagramAccount: { id: "iga1", instagramId: IG, accessToken: "enc" },
  workspace: { id: "ws1" },
  trackedLinks: [],
};

const is = (commentId: string) => ({
  name: "process-comment",
  id: "j1",
  attemptsMade: 0,
  data: {
    automationId: "a1",
    instagramAccountId: IG,
    commentId,
    commenterId: "u1",
    commenterName: "biri",
    commentText: "gta",
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.automation.findFirst.mockResolvedValue(kampanya);
  mockPrisma.automation.findMany.mockResolvedValue([kampanya]);
  mockPrisma.dmLog.findUnique.mockResolvedValue(null);
  mockPrisma.dmLog.findFirst.mockResolvedValue(null);
  mockPrisma.dmLog.upsert.mockResolvedValue({});
  mockPrisma.dmLog.update.mockResolvedValue({});
  mockPrisma.dmLog.create.mockResolvedValue({});
  mockPrisma.instagramAccount.findUnique.mockResolvedValue({
    id: "iga1",
    instagramId: IG,
    accessToken: "enc",
  });
  reserveDMSlot.mockResolvedValue({ allowed: true });
  sendPrivateReply.mockResolvedValue({ message_id: "m1" });
  sendCommentReply.mockResolvedValue({ id: "r1" });
});

describe("acik cevap kapisi", () => {
  it("SENTETIK anahtarda acik cevap DENENMEZ", async () => {
    // Canli hatadaki anahtarin ta kendisi.
    await processJob(is("dm:aWdfZAG1faXRlbToxOklHTWVzc2FnZA") as never);

    expect(sendCommentReply).not.toHaveBeenCalled();
  });

  it("reveal: ve emailgate: anahtarlarinda da denenmez", async () => {
    for (const anahtar of ["reveal:913803580619696", "emailgate:1889383725374440"]) {
      vi.clearAllMocks();
      mockPrisma.automation.findFirst.mockResolvedValue(kampanya);
      mockPrisma.dmLog.findUnique.mockResolvedValue(null);
      mockPrisma.dmLog.upsert.mockResolvedValue({});
      mockPrisma.instagramAccount.findUnique.mockResolvedValue({
        id: "iga1",
        instagramId: IG,
        accessToken: "enc",
      });
      reserveDMSlot.mockResolvedValue({ allowed: true });

      await processJob(is(anahtar) as never);

      expect(sendCommentReply, `${anahtar} icin denendi`).not.toHaveBeenCalled();
    }
  });

  it("KARSI YON: gercek yorum kimliginde acik cevap GONDERILIR", async () => {
    // Kapi asiri genis olsaydi tum acik cevaplari susturur ve bunu hicbir
    // test yakalamazdi.
    await processJob(is("17940062772091159") as never);

    expect(sendCommentReply).toHaveBeenCalledTimes(1);
    expect(sendCommentReply.mock.calls[0][1]).toBe("17940062772091159");
  });
});
