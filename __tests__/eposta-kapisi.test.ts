/**
 * E-posta kapisi — uctan uca: yorum → adres istegi → kisi adresini yazar →
 * Lead kaydi + link. Uretim worker'i (processJob) kosar; Meta API ve DB mock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockPrisma, sendPrivateReply, sendPrivateReplyWithButton, sendPrivateReplyWithLinkButton,
  sendDirectMessage, sendDirectMessageWithButton, sendDirectMessageWithLinkButton,
  getUserFollowStatus, queueAdd, reserveDMSlot,
} = vi.hoisted(() => ({
  mockPrisma: {
    automation: { findMany: vi.fn(), findFirst: vi.fn() },
    dmLog: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn(), create: vi.fn() },
    lead: { findUnique: vi.fn(), upsert: vi.fn() },
    instagramAccount: { findUnique: vi.fn() },
    operationalEvent: { create: vi.fn() },
  },
  sendPrivateReply: vi.fn(), sendPrivateReplyWithButton: vi.fn(), sendPrivateReplyWithLinkButton: vi.fn(),
  sendDirectMessage: vi.fn(), sendDirectMessageWithButton: vi.fn(), sendDirectMessageWithLinkButton: vi.fn(),
  getUserFollowStatus: vi.fn(), queueAdd: vi.fn(), reserveDMSlot: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/client", () => ({
  sendPrivateReply, sendPrivateReplyWithButton, sendPrivateReplyWithLinkButton,
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
  id: "auto_gta", workspaceId: "ws1", instagramAccountId: "iga1",
  name: "GTA VI Prompt", keywords: ["gta", "prompt"], matchAnyWord: false, wholeWordMatch: false,
  matchAnyPost: true, postId: null, dmTriggerEnabled: true,
  dmMessage: "İşte prompt: {link}", linkButtonLabel: "PROMPTA GİT",
  openingDmEnabled: true, openingDmMessage: "acilis", openingDmButtonLabel: "YOLLA",
  emailGateEnabled: true,
  emailPromptMessage: "Prompt'u yollamam için e-posta adresini yaz {username}",
  emailInvalidMessage: "Bunu adres olarak okuyamadım, ornek@eposta.com gibi yaz",
  emailThanksMessage: "Aldım, gönderiyorum 👇",
  requireFollow: false, followPromptMessage: "takip et", followPromptButtonLabel: "Following",
  followUpEnabled: false, followUpMessage: null, followUpDelayMinutes: 0,
  publicReplyEnabled: false, publicReplyMessage: null, publicReplyMessages: [],
  isActive: true,
  instagramAccount: { id: "iga1", instagramId: IG, accessToken: "enc" },
  workspace: { id: "ws1" },
  trackedLinks: [{ slug: "gta-4506ce", label: "PROMPTA GİT", destinationUrl: "https://www.yapayzekakademisi.com/promptlar/#gta" }],
};
const yorumIsi = { id: "j1", attemptsMade: 0, data: { instagramAccountId: IG, commentId: "c1", commentText: "GTA", commenterId: "u1", commenterName: "ali", mediaId: "m1" } };
const mesajIsi = (text: string) => ({ name: "process-message", id: "j2", attemptsMade: 0, data: { instagramAccountId: IG, messageId: "msg1", messageText: text, senderId: "u1" } });
const kapiKaydi = { id: "log_gate", commenterName: "ali", attempts: 0, status: "PENDING" };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.automation.findMany.mockResolvedValue([kampanya]);
  mockPrisma.automation.findFirst.mockResolvedValue(kampanya);
  mockPrisma.dmLog.findUnique.mockResolvedValue(null);
  mockPrisma.dmLog.findFirst.mockResolvedValue(null);
  mockPrisma.dmLog.create.mockResolvedValue({}); mockPrisma.dmLog.upsert.mockResolvedValue({}); mockPrisma.dmLog.update.mockResolvedValue({});
  mockPrisma.lead.findUnique.mockResolvedValue(null); mockPrisma.lead.upsert.mockResolvedValue({});
  mockPrisma.instagramAccount.findUnique.mockResolvedValue({ workspaceId: "ws1" });
  mockPrisma.operationalEvent.create.mockResolvedValue({});
  reserveDMSlot.mockResolvedValue({ allowed: true, currentCount: 1, remainingDMs: 7, shouldRequeue: false, requeueDelayMs: 0, shouldSkip: false, reserved: true });
  for (const f of [sendPrivateReply, sendPrivateReplyWithButton, sendPrivateReplyWithLinkButton, sendDirectMessage, sendDirectMessageWithButton, sendDirectMessageWithLinkButton]) f.mockResolvedValue({ recipient_id: "u1", message_id: "m" });
  getUserFollowStatus.mockResolvedValue(true);
});

describe("e-posta kapısı", () => {
  it("yorum → link DEĞİL, e-posta istemi gider (açılış DM'i devre dışı)", async () => {
    await processJob(yorumIsi as never);
    expect(sendPrivateReply).toHaveBeenCalledTimes(1);
    expect(sendPrivateReply.mock.calls[0][3]).toBe("Prompt'u yollamam için e-posta adresini yaz ali");
    expect(sendPrivateReplyWithButton).not.toHaveBeenCalled();   // açılış DM'i yok
    expect(sendPrivateReplyWithLinkButton).not.toHaveBeenCalled(); // link yok
    const kapi = mockPrisma.dmLog.upsert.mock.calls.find(c => String(c[0].create?.commentId).startsWith("emailgate:"));
    expect(kapi, "bekleme kaydı yazılmalı").toBeTruthy();
    expect(kapi![0].create.status).toBe("PENDING");
  });

  it("kişi adresini yazınca Lead kaydedilir ve link gönderilir", async () => {
    mockPrisma.dmLog.findUnique.mockImplementation(async (a: { where?: { automationId_commentId?: { commentId?: string } } }) =>
      String(a.where?.automationId_commentId?.commentId).startsWith("emailgate:") ? kapiKaydi : null);
    await processJob(mesajIsi("tabii, Ali.Koker@Gmail.com teşekkürler") as never);
    expect(mockPrisma.lead.upsert).toHaveBeenCalledTimes(1);
    const lead = mockPrisma.lead.upsert.mock.calls[0][0];
    expect(lead.create.email).toBe("ali.koker@gmail.com");
    expect(lead.create.igsid).toBe("u1");
    const linkCalls = [...sendDirectMessageWithLinkButton.mock.calls, ...sendPrivateReplyWithLinkButton.mock.calls];
    expect(linkCalls.length, "link tam olarak bir kez").toBe(1);
    const buttons = linkCalls[0][linkCalls[0].length - 1] as Array<{ title: string; url: string }>;
    expect(buttons[0].url).toMatch(/\/r\/gta-4506ce$/);
    expect(sendDirectMessage.mock.calls.some(c => c[3] === "Aldım, gönderiyorum 👇")).toBe(true);
  });

  it("bozuk adres → tekrar sorulur, link GÖNDERİLMEZ, Lead YOK", async () => {
    mockPrisma.dmLog.findUnique.mockImplementation(async (a: { where?: { automationId_commentId?: { commentId?: string } } }) =>
      String(a.where?.automationId_commentId?.commentId).startsWith("emailgate:") ? kapiKaydi : null);
    await processJob(mesajIsi("ali@ornek") as never);
    expect(mockPrisma.lead.upsert).not.toHaveBeenCalled();
    expect(sendDirectMessageWithLinkButton).not.toHaveBeenCalled();
    expect(sendDirectMessage.mock.calls[0][3]).toBe("Bunu adres olarak okuyamadım, ornek@eposta.com gibi yaz");
  });

  it("tekrar sınırı dolunca sessizce durur (sonsuz döngü yok)", async () => {
    mockPrisma.dmLog.findUnique.mockImplementation(async (a: { where?: { automationId_commentId?: { commentId?: string } } }) =>
      String(a.where?.automationId_commentId?.commentId).startsWith("emailgate:") ? { ...kapiKaydi, attempts: 3 } : null);
    await processJob(mesajIsi("hala yanlis") as never);
    expect(sendDirectMessage).not.toHaveBeenCalled();
    expect(mockPrisma.lead.upsert).not.toHaveBeenCalled();
  });

  it("akışta OLMAYAN birinin rastgele DM'i kapıyı tetiklemez (kontrol çifti)", async () => {
    mockPrisma.dmLog.findUnique.mockResolvedValue(null);  // bekleme kaydı yok
    await processJob(mesajIsi("selam nasılsın") as never);
    expect(mockPrisma.lead.upsert).not.toHaveBeenCalled();
    expect(sendDirectMessage).not.toHaveBeenCalled();
  });

  it("adresini vermiş kişi tekrar yorum yaparsa adres İSTENMEZ, link gider", async () => {
    mockPrisma.lead.findUnique.mockResolvedValue({ id: "lead1" });
    await processJob(yorumIsi as never);
    expect(sendPrivateReply.mock.calls.every(c => !String(c[3]).includes("e-posta adresini"))).toBe(true);
    expect(sendPrivateReplyWithButton).toHaveBeenCalledTimes(1);  // açılış DM'i geri döner
  });

  it("takip kapısı açıkken: adres alınır ama takip etmiyorsa link YERİNE takip istemi gider", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([{ ...kampanya, requireFollow: true }]);
    mockPrisma.dmLog.findUnique.mockImplementation(async (a: { where?: { automationId_commentId?: { commentId?: string } } }) =>
      String(a.where?.automationId_commentId?.commentId).startsWith("emailgate:") ? kapiKaydi : null);
    getUserFollowStatus.mockResolvedValue(false);
    await processJob(mesajIsi("ali@example.com") as never);
    expect(mockPrisma.lead.upsert).toHaveBeenCalledTimes(1);           // adres YİNE kaydedilir
    expect(sendDirectMessageWithLinkButton).not.toHaveBeenCalled();     // link yok
    expect(sendDirectMessageWithButton.mock.calls[0][4]).toBe("Following");
  });

  it("hız sınırı slot vermezse link gönderilmez", async () => {
    mockPrisma.dmLog.findUnique.mockImplementation(async (a: { where?: { automationId_commentId?: { commentId?: string } } }) =>
      String(a.where?.automationId_commentId?.commentId).startsWith("emailgate:") ? kapiKaydi : null);
    reserveDMSlot.mockResolvedValue({ allowed: false, currentCount: 8, remainingDMs: 0, shouldRequeue: true, requeueDelayMs: 60000, shouldSkip: false, reserved: false });
    await processJob(mesajIsi("ali@example.com") as never);
    expect(mockPrisma.lead.upsert).toHaveBeenCalledTimes(1);
    expect(sendDirectMessageWithLinkButton).not.toHaveBeenCalled();
  });
});
