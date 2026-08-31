/**
 * Hız sınırı TÜM gönderim yollarında uygulanıyor mu?
 *
 * Bu dosya bir denetimin bulgusundan doğdu: `reserveDMSlot` uzun süre yalnızca
 * `processComment` içinden çağrıldı. Opening-DM'li akışta yoruma verilen cevap
 * sadece butonlu açılış mesajıdır; **linki taşıyan asıl DM buton dokunuşundan
 * (postback) gider** ve o yol sayaca hiç uğramıyordu. Aynısı DM-tetikleyici ve
 * takip mesajı için de geçerliydi.
 *
 * Yani ölçülerek konulan 8/dk sınırı, korumak istediği gönderim sınıfının
 * üzerinde hiç çalışmıyordu. Bu testler o boşluğun geri açılmasını engeller:
 * her yol için "slot yoksa GÖNDERME" ve kontrol çifti "slot varsa GÖNDER".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockPrisma,
  mockReserveDMSlot,
  mockSendDirectMessage,
  mockSendDirectMessageWithLinkButton,
  mockSendDirectMessageWithButton,
  mockDecryptToken,
  mockMatchKeywords,
  mockQueueAdd,
  mockReserveWorkspaceDMSend,
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
    instagramAccount: { findUnique: vi.fn() },
    operationalEvent: { create: vi.fn() },
  },
  mockReserveDMSlot: vi.fn(),
  mockSendDirectMessage: vi.fn(),
  mockSendDirectMessageWithLinkButton: vi.fn(),
  mockSendDirectMessageWithButton: vi.fn(),
  mockDecryptToken: vi.fn(),
  mockMatchKeywords: vi.fn(),
  mockQueueAdd: vi.fn(),
  mockReserveWorkspaceDMSend: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/utils/pg-rate-limiter", () => ({ reserveDMSlot: mockReserveDMSlot }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: mockDecryptToken }));
vi.mock("@/lib/utils/keyword-matcher", () => ({ matchKeywords: mockMatchKeywords }));
vi.mock("@/lib/ops/worker-health", () => ({ recordWorkerAlert: vi.fn() }));
vi.mock("@/lib/billing/usage", () => ({
  reserveWorkspaceDMSend: mockReserveWorkspaceDMSend,
  releaseWorkspaceDMReservation: vi.fn(),
}));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: mockQueueAdd }),
  POSTBACK_JOB_NAME: "process-postback",
  FOLLOWUP_JOB_NAME: "process-followup",
  MESSAGE_JOB_NAME: "process-message",
}));
vi.mock("@/lib/meta/client", () => ({
  sendDirectMessage: mockSendDirectMessage,
  sendDirectMessageWithLinkButton: mockSendDirectMessageWithLinkButton,
  sendDirectMessageWithButton: mockSendDirectMessageWithButton,
  sendPrivateReply: vi.fn(),
  sendPrivateReplyWithLinkButton: vi.fn(),
  sendPrivateReplyWithButton: vi.fn(),
  sendCommentReply: vi.fn(),
  getUserFollowStatus: vi.fn().mockResolvedValue(true),
  MetaApiError: class extends Error {
    code = 0;
    subcode: number | undefined;
  },
  TokenExpiredError: class extends Error {},
  RateLimitError: class extends Error {},
}));

import { processJob } from "../lib/queue/dm-worker";

const AKIS = {
  id: "auto_1",
  workspaceId: "ws_1",
  instagramAccountId: "row_1",
  name: "Test",
  dmMessage: "iste link: https://ornek.com",
  followUpMessage: "tesekkurler ⬆️",
  followUpEnabled: true,   // processFollowUp bu bayrak kapaliyken erken doner
  followUpDelayMinutes: 0,
  linkButtonLabel: "GIT",
  requireFollow: false,
  isActive: true,
  keywords: ["link"],
  wholeWordMatch: true,
  matchAnyWord: false,
  matchAnyPost: true,
  dmTriggerEnabled: true,
  openingDmEnabled: false,
  publicReplyEnabled: false,
  publicReplyMessages: [],
  trackedLinks: [],
  instagramAccount: { id: "row_1", instagramId: "ig_1", accessToken: "sifreli" },
  workspace: { id: "ws_1" },
};

/** Slot YOK: erteleme istenir. */
const SLOT_YOK = {
  allowed: false,
  currentCount: 8,
  remainingDMs: 0,
  shouldRequeue: true,
  requeueDelayMs: 65_000,
  shouldSkip: false,
  reserved: false,
};
/** Slot VAR: gönderim beklenir (kontrol çifti). */
const SLOT_VAR = {
  allowed: true,
  currentCount: 1,
  remainingDMs: 700,
  shouldRequeue: false,
  requeueDelayMs: 0,
  shouldSkip: false,
  reserved: true,
};

function gonderimSayisi() {
  return (
    mockSendDirectMessage.mock.calls.length +
    mockSendDirectMessageWithLinkButton.mock.calls.length +
    mockSendDirectMessageWithButton.mock.calls.length
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.automation.findMany.mockResolvedValue([AKIS]);
  mockPrisma.automation.findFirst.mockResolvedValue(AKIS);
  mockPrisma.dmLog.findUnique.mockResolvedValue(null);
  mockPrisma.dmLog.findFirst.mockResolvedValue(null);
  mockPrisma.dmLog.upsert.mockResolvedValue({});
  mockPrisma.dmLog.update.mockResolvedValue({});
  mockPrisma.dmLog.create.mockResolvedValue({});
  mockPrisma.instagramAccount.findUnique.mockResolvedValue({ workspaceId: "ws_1" });
  mockPrisma.operationalEvent.create.mockResolvedValue({});
  mockDecryptToken.mockReturnValue("token");
  mockMatchKeywords.mockReturnValue({ matched: true, matchedKeyword: "link" });
  mockReserveWorkspaceDMSend.mockResolvedValue({
    allowed: true,
    reserved: true,
    remaining: 100,
    limit: 2000,
    periodStart: new Date(),
  });
  mockSendDirectMessage.mockResolvedValue({ message_id: "m1" });
  mockSendDirectMessageWithLinkButton.mockResolvedValue({ message_id: "m2" });
  mockSendDirectMessageWithButton.mockResolvedValue({ message_id: "m3" });
});

const YOLLAR = [
  {
    ad: "postback (buton dokunusu — LINKI TASIYAN yol)",
    job: {
      name: "process-postback",
      id: "j1",
      attemptsMade: 0,
      data: { instagramAccountId: "ig_1", userId: "u1", payload: "reveal:auto_1" },
    },
  },
  {
    ad: "followup (takip mesaji)",
    job: {
      name: "process-followup",
      id: "j2",
      attemptsMade: 0,
      data: { instagramAccountId: "ig_1", userId: "u1", automationId: "auto_1" },
    },
  },
  {
    ad: "message (DM tetikleyici)",
    job: {
      name: "process-message",
      id: "j3",
      attemptsMade: 0,
      data: {
        instagramAccountId: "ig_1",
        messageId: "mid_1",
        messageText: "link",
        senderId: "u1",
      },
    },
  },
];

describe("hiz siniri her gonderim yolunda uygulaniyor", () => {
  for (const { ad, job } of YOLLAR) {
    it(`${ad}: slot YOKKEN gondermiyor`, async () => {
      mockReserveDMSlot.mockResolvedValue(SLOT_YOK);
      await processJob(job as never);
      expect(mockReserveDMSlot).toHaveBeenCalled();
      expect(gonderimSayisi()).toBe(0);
    });

    // Kontrol cifti: "hep engelle" de ilk testi gecerdi. Bu, sinirin acildigini kanitlar.
    it(`${ad}: slot VARKEN gonderiyor`, async () => {
      mockReserveDMSlot.mockResolvedValue(SLOT_VAR);
      await processJob(job as never);
      expect(gonderimSayisi()).toBeGreaterThan(0);
    });
  }

  it("ertelenen is KUYRUGA geri konuyor (kaybolmuyor)", async () => {
    mockReserveDMSlot.mockResolvedValue(SLOT_YOK);
    await processJob(YOLLAR[0].job as never);
    expect(mockQueueAdd).toHaveBeenCalled();
    const [, , opts] = mockQueueAdd.mock.calls[0];
    expect(opts.delay).toBe(65_000);
    // Tekillestirme anahtari denemeyi TASIMALI: aksi halde ikinci kuyruklama
    // "zaten var" diye yutulur ve is sonsuza dek kaybolur.
    expect(String(opts.jobId)).toContain("retry_1");
  });

  it("sabir tukendiginde kuyruga KONMUYOR (sonsuz dongu yok)", async () => {
    mockReserveDMSlot.mockResolvedValue({
      ...SLOT_YOK,
      shouldRequeue: false,
      shouldSkip: true,
    });
    await processJob(YOLLAR[0].job as never);
    expect(gonderimSayisi()).toBe(0);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});
