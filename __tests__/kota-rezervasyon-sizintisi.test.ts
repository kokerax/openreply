/**
 * Hiz siniri yuzunden gonderilmeyen DM kotayi TUKETMEMELI.
 *
 * Canli olcum (2026-09-09, ayni pencere):
 *   Workspace sayaci        595
 *   gercek SENT gonderim    589   -> %1 fazla sayim
 *
 * Sebep: uc yol once `reserveWorkspaceDMSend` ile kotayi rezerve ediyor,
 * sonra `hizSlotuAl` false donunce SERBEST BIRAKMADAN `return` ediyor. Is
 * yeniden kuyruklandiginda tekrar rezerve ediliyor, yani her erteleme
 * sayaci bir artiriyor ama tek bir DM gidiyor.
 *
 * Ana yorum yolu bunu DOGRU yapiyor (rate limit'te release cagiriyor);
 * postback, e-posta ve DM tetikleyici yollari atlamis.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockPrisma,
  reserveDMSlot,
  reserveWorkspaceDMSend,
  releaseWorkspaceDMReservation,
  queueAdd,
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
  reserveDMSlot: vi.fn(),
  reserveWorkspaceDMSend: vi.fn(),
  releaseWorkspaceDMReservation: vi.fn(),
  queueAdd: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/client", () => ({
  sendPrivateReply: vi.fn(),
  sendPrivateReplyWithButton: vi.fn(),
  sendPrivateReplyWithLinkButton: vi.fn(),
  sendDirectMessage: vi.fn(),
  sendDirectMessageWithButton: vi.fn(),
  sendDirectMessageWithLinkButton: vi.fn(),
  getUserFollowStatus: vi.fn(async () => true),
  sendCommentReply: vi.fn(),
  MetaApiError: class extends Error {
    code = 0;
  },
  TokenExpiredError: class extends Error {},
  RateLimitError: class extends Error {},
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: () => "tok" }));
vi.mock("@/lib/utils/pg-rate-limiter", () => ({ reserveDMSlot }));
vi.mock("@/lib/billing/usage", () => ({
  reserveWorkspaceDMSend,
  releaseWorkspaceDMReservation,
}));
vi.mock("@/lib/ops/worker-health", () => ({ recordWorkerAlert: vi.fn() }));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: queueAdd }),
  getRedisConnection: vi.fn(),
  POSTBACK_JOB_NAME: "process-postback",
  FOLLOWUP_JOB_NAME: "process-followup",
  MESSAGE_JOB_NAME: "process-message",
}));

import { processJob } from "../lib/queue/dm-worker";

const IG = "17841465942418709";
const DONEM = new Date("2026-09-01T00:00:00Z");

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
  publicReplyEnabled: false,
  publicReplyMessages: [],
  publicReplyMessage: null,
  isActive: true,
  instagramAccount: { id: "iga1", instagramId: IG, accessToken: "enc" },
  workspace: { id: "ws1" },
  trackedLinks: [],
};

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
  reserveWorkspaceDMSend.mockResolvedValue({
    allowed: true,
    reserved: true,
    remaining: 9,
    limit: 2000,
    periodStart: DONEM,
  });
  releaseWorkspaceDMReservation.mockResolvedValue({ count: 1 });
  // Hiz siniri DOLU: is ertelenecek, DM GITMEYECEK.
  reserveDMSlot.mockResolvedValue({
    allowed: false,
    shouldRequeue: true,
    requeueDelayMs: 60_000,
    currentCount: 8,
  });
});

const postbackIsi = () => ({
  name: "process-postback",
  id: "p1",
  attemptsMade: 0,
  data: {
    instagramAccountId: IG,
    userId: "u1",
    payload: "reveal:a1",
    fallback: false,
  },
});

describe("hiz siniri ertelemesi kotayi tuketmez", () => {
  it("postback yolunda rezervasyon SERBEST BIRAKILIR", async () => {
    await processJob(postbackIsi() as never);

    expect(reserveWorkspaceDMSend).toHaveBeenCalled();
    // Is ertelendi ve tekrar rezerve edecek; birakilmazsa her erteleme
    // sayaci bir artirir.
    expect(releaseWorkspaceDMReservation).toHaveBeenCalledWith("ws1", DONEM);
  });

  it("erteleme gercekten olmus — is yeniden kuyruklandi", async () => {
    // Kontrol: senaryonun kurulumu dogru, yani gonderim ATLANMIS.
    await processJob(postbackIsi() as never);
    expect(queueAdd).toHaveBeenCalled();
  });

  it("KARSI YON: slot VARSA rezervasyon birakilmaz", async () => {
    // Kapi asiri genis olsaydi basarili gonderimlerin kotasi da geri
    // verilir ve sayac hep sifir kalirdi.
    reserveDMSlot.mockResolvedValue({ allowed: true });

    await processJob(postbackIsi() as never);

    expect(releaseWorkspaceDMReservation).not.toHaveBeenCalled();
  });
});
