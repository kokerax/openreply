import type { Job } from "bullmq";
import {
  getDMQueue,
  MESSAGE_JOB_NAME,
  POSTBACK_JOB_NAME,
  FOLLOWUP_JOB_NAME,
  type DmQueueJob,
  type ProcessCommentJob,
  type ProcessMessageJob,
  type ProcessPostbackJob,
  type ProcessFollowUpJob,
} from "./client";
import { prisma } from "@/lib/db/client";
import { isleriKilitle, isiTamamla, isiBasarisizYap } from "./pg-queue";
import {
  MetaApiError,
  RateLimitError,
  TokenExpiredError,
  getUserFollowStatus,
  sendCommentReply,
  sendDirectMessage,
  sendDirectMessageWithButton,
  sendDirectMessageWithLinkButton,
  sendPrivateReply,
  sendPrivateReplyWithButton,
  sendPrivateReplyWithLinkButton,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { matchKeywords } from "@/lib/utils/keyword-matcher";
import { reserveDMSlot } from "@/lib/utils/pg-rate-limiter";
import {
  releaseWorkspaceDMReservation,
  reserveWorkspaceDMSend,
} from "@/lib/billing/usage";
import { recordWorkerAlert } from "@/lib/ops/worker-health";
import {
  buildTrackedUrl,
  renderMessageWithTracking,
  renderMessageWithoutLink,
} from "@/lib/tracking/message";
import { extractEmail } from "@/lib/utils/email-extract";

const BACKOFF_DELAYS = [5 * 60 * 1000, 15 * 60 * 1000, 45 * 60 * 1000];

/**
 * True for the one Meta rejection that is not a rejection.
 *
 * `code=1` with no subcode ("An unknown error has occurred") is returned by the
 * messages edge while the message still reaches the recipient. It is kept
 * narrow deliberately: any code other than 1, or a code 1 that carries a
 * subcode, describes a real refusal and must stay FAILED.
 */
function isDeliveredDespiteError(error: unknown): boolean {
  return (
    error instanceof MetaApiError &&
    error.code === 1 &&
    (error.subcode === undefined || error.subcode === null)
  );
}

/**
 * Gönderim öncesi hız slotu al — YORUM DIŞINDAKİ yollar için.
 *
 * `reserveDMSlot` uzun süre yalnızca `processComment` içinden çağrıldı. Ama
 * opening-DM'li akışta yoruma verilen cevap sadece butonlu açılış mesajıdır;
 * **linki taşıyan asıl DM buton dokunuşundan (postback) gider** ve o yol
 * sayaca hiç uğramıyordu. Aynısı DM-tetikleyici ve takip mesajı için de
 * geçerliydi. Yani ölçülerek konulan 8/dk sınırı, korumak istediği gönderim
 * sınıfının üzerinde çalışmıyordu: bir reel patlayıp 60 kişi aynı dakikada
 * butona bastığında hiçbir fren yoktu.
 *
 * Slot yoksa iş kuyruğa geri konur (kaybolmaz); sabır tükenmişse atlanır.
 * Dönüş `false` ise çağıran HEMEN dönmeli — gönderim yapılmamalıdır.
 */
async function hizSlotuAl(
  instagramAccountId: string,
  job: Job<DmQueueJob>,
  isAdi: string
): Promise<boolean> {
  const deneme = job.attemptsMade ?? 0;
  const slot = await reserveDMSlot(instagramAccountId, deneme);
  if (slot.allowed) return true;

  if (slot.shouldRequeue) {
    await getDMQueue().add(job.name as string, job.data, {
      delay: slot.requeueDelayMs,
      // Tekillestirme anahtari denemeyi TASIR: aksi halde ikinci kuyruklama
      // "zaten var" diye sessizce yutulur ve is sonsuza dek kaybolur.
      jobId: `${isAdi}_retry_${deneme + 1}_${job.id}`,
    });
    console.log(
      `[hiz] ${isAdi} ertelendi (${Math.round(slot.requeueDelayMs / 1000)} sn) — sayac ${slot.currentCount}`
    );
  } else {
    console.log(`[hiz] ${isAdi} ATLANDI — sabir tukendi (deneme ${deneme})`);
  }
  return false;
}

function formatError(error: unknown): string {
  if (error instanceof MetaApiError) {
    return `Meta API Error ${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

// Meta rejections that a plain-text retry cannot fix: the send was refused for
// the conversation, not for the button template. Retrying as text just burns
// the attempt and — worse — overwrites the real error with a misleading one
// ("invalid for a private reply", because the first attempt already used up the
// comment's single allowed private reply).
const NON_TEMPLATE_REJECTIONS = [
  /outside of allowed window/i,
  /invalid for a private reply/i,
  /requested user cannot be found/i,
];

function isTemplateRejection(error: unknown): boolean {
  if (error instanceof TokenExpiredError || error instanceof RateLimitError) {
    return false;
  }
  const message = error instanceof Error ? error.message : "";
  return !NON_TEMPLATE_REJECTIONS.some((pattern) => pattern.test(message));
}

type WorkerTrackedLink = {
  slug: string;
  label: string | null;
  destinationUrl: string;
};

/**
 * Build the tappable link buttons for a DM. The first link uses the campaign's
 * `linkButtonLabel`; each additional link uses its own stored `label`. Capped at
 * Meta's 3-button limit for a button template.
 */
function buildLinkButtons(
  trackedLinks: WorkerTrackedLink[],
  primaryLabel: string | null
): { title: string; url: string }[] {
  return trackedLinks.slice(0, 3).map((link, index) => ({
    url: buildTrackedUrl(link.slug),
    title: (index === 0 ? primaryLabel : link.label) || link.label || "Open link",
  }));
}

/**
 * Fallback text when Meta rejects the button template: render the primary link
 * inline, then append any extra tracked URLs on their own lines so no link is
 * lost.
 */
function buildInlineLinkFallback(
  message: string,
  commenterName: string | null | undefined,
  trackedLinks: WorkerTrackedLink[],
  bodyText: string
): string {
  const base =
    renderMessageWithTracking({ message, commenterName, trackedLinks }) ||
    bodyText;
  const extraUrls = trackedLinks.slice(1).map((link) => buildTrackedUrl(link.slug));
  return extraUrls.length > 0 ? `${base}\n${extraUrls.join("\n")}` : base;
}

type RevealAutomation = {
  dmMessage: string;
  linkButtonLabel: string | null;
  trackedLinks: WorkerTrackedLink[];
  instagramAccount: { instagramId: string };
};

/**
 * Deliver a campaign's reveal message as a direct message. Shared by the
 * button-tap (postback) path and the DM keyword-trigger path — both already
 * have an open conversation with the user, so neither uses a private reply.
 */
async function sendRevealDirectMessage(
  accessToken: string,
  automation: RevealAutomation,
  userId: string,
  commenterName: string | null,
  context: string
): Promise<void> {
  if (automation.trackedLinks.length === 0) {
    await sendDirectMessage(
      accessToken,
      automation.instagramAccount.instagramId,
      userId,
      renderMessageWithTracking({
        message: automation.dmMessage,
        commenterName,
        trackedLinks: automation.trackedLinks,
      })
    );
    return;
  }

  // Try button template first; if Meta rejects it, fall back to inline links.
  const bodyText =
    renderMessageWithoutLink({
      message: automation.dmMessage,
      commenterName,
    }) || "Here's your link:";
  const buttons = buildLinkButtons(
    automation.trackedLinks,
    automation.linkButtonLabel
  );

  try {
    await sendDirectMessageWithLinkButton(
      accessToken,
      automation.instagramAccount.instagramId,
      userId,
      bodyText,
      buttons
    );
  } catch (buttonError) {
    // A closed messaging window rejects the text retry too, so don't let it
    // overwrite the original error with a misleading one.
    if (!isTemplateRejection(buttonError)) throw buttonError;

    console.log(
      `[DM Worker] Button template rejected in ${context}, falling back to inline link:`,
      formatError(buttonError)
    );
    try {
      await sendDirectMessage(
        accessToken,
        automation.instagramAccount.instagramId,
        userId,
        buildInlineLinkFallback(
          automation.dmMessage,
          commenterName,
          automation.trackedLinks,
          bodyText
        )
      );
    } catch {
      throw buttonError;
    }
  }
}

async function processComment(job: Job<ProcessCommentJob>): Promise<void> {
  const {
    instagramAccountId,
    commentId,
    commentText,
    commenterId,
    commenterName,
    mediaId,
    originalMediaId,
  } = job.data;
  const requeueAttempt = job.data.requeueAttempt ?? 0;

  const automations = await prisma.automation.findMany({
    where: {
      // Match campaigns bound to this specific post, plus any-post campaigns.
      // A comment left on an ad carries the ad's own media id, while the
      // campaign is bound to the post the ad was created from, so both ids
      // have to be considered or the comment is dropped without a trace.
      OR: [
        { postId: mediaId },
        ...(originalMediaId ? [{ postId: originalMediaId }] : []),
        { matchAnyPost: true },
      ],
      isActive: true,
      instagramAccount: {
        instagramId: instagramAccountId,
      },
    },
    include: {
      instagramAccount: true,
      workspace: true,
      trackedLinks: {
        select: {
          slug: true,
          label: true,
          destinationUrl: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  for (const automation of automations) {
    // "Any word" campaigns fire on every comment; otherwise require a keyword hit.
    const matchResult = automation.matchAnyWord
      ? { matched: true, matchedKeyword: null }
      : matchKeywords(
          commentText,
          automation.keywords,
          automation.wholeWordMatch
        );

    if (!matchResult.matched) {
      continue;
    }

    const existingLog = await prisma.dmLog.findUnique({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId,
        },
      },
    });

    const alreadyDmd = existingLog?.status === "SENT";
    const alreadyPublicReplied = Boolean(existingLog?.publicReplySentAt);
    const needsDm = !alreadyDmd;

    // Skip only when there is genuinely nothing left to do. A comment whose DM
    // already sent but whose public reply never posted (e.g. it hit a rate
    // limit) must still come back so the public reply can be retried.
    if (existingLog?.status === "SKIPPED_PLAN_LIMIT") continue;
    if (alreadyDmd && (alreadyPublicReplied || !automation.publicReplyEnabled)) {
      continue;
    }

    if (!automation.instagramAccount.accessToken) {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        create: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId,
          commenterName,
          commentText,
          commentId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "FAILED",
          errorMessage: "No Instagram access token available",
        },
        update: {
          status: "FAILED",
          errorMessage: "No Instagram access token available",
        },
      });
      continue;
    }

    let accessToken: string;
    try {
      accessToken = decryptToken(automation.instagramAccount.accessToken);
    } catch {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        create: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId,
          commenterName,
          commentText,
          commentId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "FAILED",
          errorMessage: "Failed to decrypt Instagram access token",
        },
        update: {
          status: "FAILED",
          errorMessage: "Failed to decrypt Instagram access token",
        },
      });
      continue;
    }

    // Ensure a log row exists before the public reply leg (which updates it).
    // Only (re)set PENDING when the DM will actually be attempted, so a prior
    // SENT is never clobbered while we come back just to retry the public reply.
    if (!existingLog) {
      await prisma.dmLog.create({
        data: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId,
          commenterName,
          commentText,
          commentId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "PENDING",
          attempts: job.attemptsMade + 1,
        },
      });
    } else if (needsDm) {
      await prisma.dmLog.update({
        where: {
          automationId_commentId: { automationId: automation.id, commentId },
        },
        data: {
          status: "PENDING",
          attempts: job.attemptsMade + 1,
          matchedKeyword: matchResult.matchedKeyword,
          errorMessage: null,
        },
      });
    }

    // Public reply leg — decoupled from the DM and posted first so a DM failure
    // (e.g. a non-follower whose messaging is restricted) never suppresses it.
    // Idempotent across retries via publicReplySentAt.
    const replyPool =
      automation.publicReplyMessages.length > 0
        ? automation.publicReplyMessages
        : automation.publicReplyMessage
          ? [automation.publicReplyMessage]
          : [];
    if (
      automation.publicReplyEnabled &&
      replyPool.length > 0 &&
      !existingLog?.publicReplySentAt
    ) {
      try {
        const chosen = replyPool[Math.floor(Math.random() * replyPool.length)];
        const publicReply = renderMessageWithTracking({
          message: chosen,
          commenterName,
          trackedLinks: automation.trackedLinks,
        });
        await sendCommentReply(accessToken, commentId, publicReply);
        await prisma.dmLog.update({
          where: {
            automationId_commentId: { automationId: automation.id, commentId },
          },
          data: { publicReplySentAt: new Date(), publicReplyError: null },
        });
      } catch (error) {
        console.error(
          "[DM Worker] Public comment reply failed:",
          formatError(error)
        );
        await prisma.dmLog
          .update({
            where: {
              automationId_commentId: { automationId: automation.id, commentId },
            },
            data: { publicReplyError: formatError(error) },
          })
          .catch(() => {});
      }
    }

    // DM already sent on an earlier pass; the public reply retry above was all
    // this run needed. Don't re-send the DM.
    if (!needsDm) continue;

    // Meta allows exactly ONE private reply per comment, ever — across every
    // campaign. When several campaigns match the same comment (duplicated
    // campaigns, or an any-post campaign overlapping a post-specific one), only
    // the first can deliver; the rest would fail with "The comment is invalid
    // for a private reply". Skip them explicitly instead of burning an API call
    // and logging a failure the user can do nothing about. The public reply
    // above still goes out per campaign — only the DM leg is deduped.
    const privateReplyUsedBy = await prisma.dmLog.findFirst({
      where: {
        commentId,
        status: "SENT",
        automationId: { not: automation.id },
      },
      select: { automation: { select: { name: true } } },
    });
    if (privateReplyUsedBy) {
      await prisma.dmLog.update({
        where: {
          automationId_commentId: { automationId: automation.id, commentId },
        },
        data: {
          status: "SKIPPED_DEDUP",
          matchedKeyword: matchResult.matchedKeyword,
          errorMessage: `Another campaign (${privateReplyUsedBy.automation?.name ?? "unknown"}) already sent the one private reply Instagram allows for this comment`,
        },
      });
      continue;
    }

    const usage = await reserveWorkspaceDMSend(automation.workspaceId);
    if (!usage.allowed) {
      await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "SKIPPED_PLAN_LIMIT",
          matchedKeyword: matchResult.matchedKeyword,
          errorMessage: `Monthly DM limit reached (${usage.limit})`,
        },
      });
      continue;
    }

    let rateLimit;
    try {
      rateLimit = await reserveDMSlot(instagramAccountId, requeueAttempt);
    } catch (error) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );
      await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
        },
      });
      throw error;
    }

    if (!rateLimit.allowed) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );

      if (rateLimit.shouldSkip) {
        await prisma.dmLog.update({
          where: {
            automationId_commentId: {
              automationId: automation.id,
              commentId,
            },
          },
          data: {
            status: "SKIPPED_RATE_LIMIT",
            matchedKeyword: matchResult.matchedKeyword,
            errorMessage: "Hourly Instagram DM rate limit reached",
          },
        });
        continue;
      }

      if (rateLimit.shouldRequeue) {
        await prisma.dmLog.update({
          where: {
            automationId_commentId: {
              automationId: automation.id,
              commentId,
            },
          },
          data: {
            status: "PENDING",
            matchedKeyword: matchResult.matchedKeyword,
            errorMessage: "Hourly rate limit hit; retry scheduled",
          },
        });

        await getDMQueue().add(
          "process-comment",
          {
            ...job.data,
            requeueAttempt: requeueAttempt + 1,
          },
          {
            delay: rateLimit.requeueDelayMs,
            jobId: `comment_${instagramAccountId}_${commentId}_retry_${requeueAttempt + 1}`,
          }
        );
        continue;
      }
    }

    // E-posta kapisi: link gonderilmeden ONCE adres istenir. Bu dal acikken
    // acilis DM'i / takip istemi / link DEVREYE GIRMEZ — kisi adresini yazinca
    // (processMessage -> epostaKapisiniIsle) sira onlara gelir.
    const epostaKapisi =
      automation.emailGateEnabled &&
      !(await epostaVerdiMi(automation.id, commenterId));

    // With an opening DM, the private reply is a button message; tapping it
    // fires a postback that delivers the reveal (see processPostback). Without
    // one, we send the reveal text directly as today.
    const useOpeningDm =
      !epostaKapisi &&
      automation.openingDmEnabled &&
      Boolean(automation.openingDmMessage) &&
      Boolean(automation.openingDmButtonLabel);

    // Follow-gating: the link is revealed only after a follow. When an opening
    // DM is enabled it comes FIRST, and its button routes into the follow check
    // (opening DM → follow gate → link). Without an opening DM, we check follow
    // status at comment time: confirmed followers get the link now, everyone
    // else gets the "follow me first" prompt (re-verified on tap).
    let sendFollowPrompt = false;
    if (automation.requireFollow && !useOpeningDm && !epostaKapisi) {
      const alreadyFollows = await getUserFollowStatus(accessToken, commenterId);
      sendFollowPrompt = alreadyFollows !== true;
    }

    try {
      if (epostaKapisi) {
        const istemMetni = renderMessageWithoutLink({
          message:
            automation.emailPromptMessage ||
            "Linki gondermem icin e-posta adresini bu sohbete yazar misin?",
          commenterName,
        });
        await sendPrivateReply(
          accessToken,
          automation.instagramAccount.instagramId,
          commentId,
          istemMetni
        );
        // Bekleme kaydi: processMessage bu satiri gorup kisinin akista
        // oldugunu anlar; commenterName'i ve tekrar sayacini da tasir.
        await prisma.dmLog.upsert({
          where: {
            automationId_commentId: {
              automationId: automation.id,
              commentId: epostaKapisiAnahtari(commenterId),
            },
          },
          create: {
            workspaceId: automation.workspaceId,
            automationId: automation.id,
            instagramAccountId: automation.instagramAccountId,
            commenterId,
            commenterName,
            commentText: "(e-posta bekleniyor)",
            commentId: epostaKapisiAnahtari(commenterId),
            status: "PENDING",
          },
          update: { commenterName },
        });
      } else if (useOpeningDm) {
        const openingText = renderMessageWithTracking({
          message: automation.openingDmMessage as string,
          commenterName,
          trackedLinks: [],
        });
        await sendPrivateReplyWithButton(
          accessToken,
          automation.instagramAccount.instagramId,
          commentId,
          openingText,
          automation.openingDmButtonLabel as string,
          automation.requireFollow
            ? `followcheck:${automation.id}`
            : `reveal:${automation.id}`
        );
      } else if (sendFollowPrompt) {
        const promptText = renderMessageWithoutLink({
          message:
            automation.followPromptMessage ||
            "quick favor before i send your link. i don't make any money from this, it's free. if you want to support me, just don't unfollow after, and star the repo on github if it helps you. tap the button once you're following and i'll send it over",
          commenterName,
        });
        await sendPrivateReplyWithButton(
          accessToken,
          automation.instagramAccount.instagramId,
          commentId,
          promptText,
          automation.followPromptButtonLabel || "i'm following",
          `followcheck:${automation.id}`
        );
      } else if (automation.trackedLinks.length > 0) {
        // Try button template first; if Meta rejects it, fall back to inline links.
        const bodyText =
          renderMessageWithoutLink({
            message: automation.dmMessage,
            commenterName,
          }) || "Here's your link:";
        const buttons = buildLinkButtons(
          automation.trackedLinks,
          automation.linkButtonLabel
        );

        try {
          await sendPrivateReplyWithLinkButton(
            accessToken,
            automation.instagramAccount.instagramId,
            commentId,
            bodyText,
            buttons
          );
        } catch (buttonError) {
          // Only a template rejection is worth retrying as text. Anything else
          // (closed window, comment already replied to) fails the same way and
          // would replace the real error with a misleading one.
          if (!isTemplateRejection(buttonError)) throw buttonError;

          console.log(
            "[DM Worker] Button template rejected, falling back to inline link:",
            formatError(buttonError)
          );
          const fallbackMessage = buildInlineLinkFallback(
            automation.dmMessage,
            commenterName,
            automation.trackedLinks,
            bodyText
          );
          try {
            await sendPrivateReply(
              accessToken,
              automation.instagramAccount.instagramId,
              commentId,
              fallbackMessage
            );
          } catch {
            // The first attempt consumed the comment's single private reply, so
            // this one reports "invalid for a private reply" no matter what the
            // underlying problem was. Surface the original rejection instead.
            throw buttonError;
          }
        }
      } else {
        const dmMessage = renderMessageWithTracking({
          message: automation.dmMessage,
          commenterName,
          trackedLinks: automation.trackedLinks,
        });
        await sendPrivateReply(
          accessToken,
          automation.instagramAccount.instagramId,
          commentId,
          dmMessage
        );
      }

      await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "SENT",
          dmSentAt: new Date(),
          errorMessage: null,
        },
      });
    } catch (error) {
      // Meta's bare `code=1` on the messages edge is not a delivery failure.
      // Verified on 2026-08-31: 41 sends that returned this error were checked
      // against the account's own conversation threads afterwards and all 41
      // messages were present — one recipient even replied to the message the
      // API had just reported as failed. Recording it as FAILED made the DM
      // look undelivered, and a retry then sent the same person a second copy.
      // So it is recorded as sent, with the anomaly kept in errorMessage so the
      // rate stays visible rather than being silently swallowed.
      if (isDeliveredDespiteError(error)) {
        await prisma.dmLog.update({
          where: {
            automationId_commentId: { automationId: automation.id, commentId },
          },
          data: {
            status: "SENT",
            dmSentAt: new Date(),
            attempts: job.attemptsMade + 1,
            errorMessage: `teslim edildi, Meta yanlis hata dondu: ${formatError(error)}`,
          },
        });
        return;
      }

      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );

      await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
        },
      });
      throw error;
    }
  }
}

/**
 * Deliver the reveal message after a user taps an opening DM's button.
 * The postback payload is `reveal:<automationId>`; the sender is the user's
 * IGSID (same id as their comment author id), which we DM directly.
 */
/** epostaSonrasiLinkiGonder'in ihtiyaci: reveal alanlari + kapi/kota alanlari. */
type EpostaKapisiKampanyasi = RevealAutomation & {
  id: string;
  workspaceId: string;
  instagramAccountId: string;
  requireFollow: boolean;
  followPromptMessage: string | null;
  followPromptButtonLabel: string | null;
  followUpEnabled: boolean;
  followUpMessage: string | null;
  followUpDelayMinutes: number | null;
};

/* ------------------------- E-POSTA KAPISI ------------------------- */

/** Kisi basina TEK bekleme kaydi; DmLog'un (automationId, commentId) benzersizligini kullanir. */
function epostaKapisiAnahtari(igsid: string): string {
  return `emailgate:${igsid}`;
}

/** Bozuk adres icin kac kez tekrar sorulur (sonsuz dongu olmasin). */
const EPOSTA_MAX_TEKRAR = 3;

/**
 * Bu kisi bu kampanyada e-posta kapisini gecti mi?
 * Lead varsa gecmistir — bir daha adres istenmez.
 */
async function epostaVerdiMi(automationId: string, igsid: string): Promise<boolean> {
  const lead = await prisma.lead.findUnique({
    where: { automationId_igsid: { automationId, igsid } },
    select: { id: true },
  });
  return Boolean(lead);
}

/**
 * E-posta alindiktan sonra asil linki gonderir. processPostback'in kuyrugundaki
 * ayni sira: kota -> hiz slotu -> reveal -> takip mesaji -> log.
 * Takip kapisi ACIK ise once o kontrol edilir (fail-open: yalnizca kesin
 * "takip etmiyor" cevabi engeller — kisi zaten adresini vermis durumda).
 */
async function epostaSonrasiLinkiGonder(
  job: Job<DmQueueJob>,
  accessToken: string,
  automation: EpostaKapisiKampanyasi,
  igsid: string,
  commenterName: string | null
): Promise<void> {
  if (automation.requireFollow) {
    const follows = await getUserFollowStatus(accessToken, igsid);
    if (follows === false) {
      const promptText = renderMessageWithoutLink({
        message:
          automation.followPromptMessage ||
          "Linki gondermem icin once takip etmen gerekiyor. Takip ettikten sonra butona bas.",
        commenterName,
      });
      await sendDirectMessageWithButton(
        accessToken,
        automation.instagramAccount.instagramId,
        igsid,
        promptText,
        automation.followPromptButtonLabel || "Following",
        `followcheck:${automation.id}`
      );
      return;
    }
  }

  const dedupeId = `reveal:${igsid}`;
  const usage = await reserveWorkspaceDMSend(automation.workspaceId);
  if (!usage.allowed) return;
  if (!(await hizSlotuAl(automation.instagramAccount.instagramId, job, "eposta"))) return;

  try {
    await sendRevealDirectMessage(
      accessToken,
      automation,
      igsid,
      commenterName,
      "postback"
    );
    if (automation.followUpEnabled && automation.followUpMessage?.trim()) {
      await getDMQueue().add(
        FOLLOWUP_JOB_NAME,
        {
          instagramAccountId: automation.instagramAccount.instagramId,
          userId: igsid,
          automationId: automation.id,
          commenterName,
        },
        {
          delay: Math.max(0, automation.followUpDelayMinutes ?? 0) * 60_000,
          jobId: `followup_${automation.id}_${igsid}`,
        }
      );
    }
    await prisma.dmLog.upsert({
      where: { automationId_commentId: { automationId: automation.id, commentId: dedupeId } },
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: igsid,
        commenterName,
        commentText: "(e-posta alindi)",
        commentId: dedupeId,
        status: "SENT",
        dmSentAt: new Date(),
      },
      update: { status: "SENT", dmSentAt: new Date(), errorMessage: null },
    });
  } catch (error) {
    await releaseWorkspaceDMReservation(automation.workspaceId, usage.periodStart);
    await prisma.dmLog.upsert({
      where: { automationId_commentId: { automationId: automation.id, commentId: dedupeId } },
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: igsid,
        commenterName,
        commentText: "(e-posta alindi)",
        commentId: dedupeId,
        status: "FAILED",
        errorMessage: formatError(error),
      },
      update: { status: "FAILED", errorMessage: formatError(error) },
    });
    throw error;
  }
}

/**
 * Gelen DM'i e-posta kapisi acisindan degerlendirir.
 * Doner: true = bu mesaj kapi tarafindan ele alindi, normal anahtar-kelime
 * akisi CALISTIRILMAMALI.
 */
async function epostaKapisiniIsle(
  job: Job<ProcessMessageJob>,
  igAccountId: string,
  senderId: string,
  messageText: string
): Promise<boolean> {
  const bekleyenler = await prisma.automation.findMany({
    where: {
      isActive: true,
      emailGateEnabled: true,
      instagramAccount: { instagramId: igAccountId },
    },
    include: {
      instagramAccount: true,
      workspace: true,
      trackedLinks: {
        select: { slug: true, label: true, destinationUrl: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  for (const automation of bekleyenler) {
    // Sorgu zaten filtreliyor; burada da bakiyoruz ki fonksiyon cagiran koddan
    // bagimsiz olarak dogru olsun (kapi kapaliysa hicbir sey yapma).
    if (!automation.emailGateEnabled) continue;
    if (await epostaVerdiMi(automation.id, senderId)) continue;

    // Kisi bu kampanyanin akisinda mi? (yorum yapti ve kendisine adres soruldu)
    // Kayit yoksa bu, kapiyla ilgisi olmayan rastgele bir DM'dir — dokunma.
    const kapiKaydi = await prisma.dmLog.findUnique({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId: epostaKapisiAnahtari(senderId),
        },
      },
    });
    if (!kapiKaydi) continue;

    if (!automation.instagramAccount.accessToken) continue;
    let accessToken: string;
    try {
      accessToken = decryptToken(automation.instagramAccount.accessToken);
    } catch {
      continue;
    }
    const commenterName = kapiKaydi.commenterName ?? null;
    const eposta = extractEmail(messageText);

    if (!eposta) {
      // Bozuk/eksik adres: sinirli sayida tekrar sor, sonra sessizce birak
      // (kisi baska bir sey yaziyor olabilir; sonsuz "adres yaz" dongusu YOK).
      if ((kapiKaydi.attempts ?? 0) >= EPOSTA_MAX_TEKRAR) return true;
      await prisma.dmLog.update({
        where: { id: kapiKaydi.id },
        data: { attempts: { increment: 1 } },
      });
      if (!(await hizSlotuAl(igAccountId, job as Job<DmQueueJob>, "eposta-tekrar"))) return true;
      try {
        await sendDirectMessage(
          accessToken,
          automation.instagramAccount.instagramId,
          senderId,
          renderMessageWithoutLink({
            message:
              automation.emailInvalidMessage ||
              "Bunu bir e-posta adresi olarak okuyamadim. ornek@eposta.com seklinde yazar misin?",
            commenterName,
          })
        );
      } catch (error) {
        console.log("[DM Worker] E-posta tekrar istegi gonderilemedi:", formatError(error));
      }
      return true;
    }

    await prisma.lead.upsert({
      where: { automationId_igsid: { automationId: automation.id, igsid: senderId } },
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        igsid: senderId,
        username: commenterName,
        email: eposta,
        sourceText: messageText.slice(0, 500),
      },
      update: { email: eposta, sourceText: messageText.slice(0, 500), username: commenterName },
    });
    await prisma.dmLog.update({
      where: { id: kapiKaydi.id },
      data: { status: "SENT", dmSentAt: new Date(), errorMessage: null },
    });

    const tesekkur = automation.emailThanksMessage?.trim();
    if (tesekkur) {
      try {
        await sendDirectMessage(
          accessToken,
          automation.instagramAccount.instagramId,
          senderId,
          renderMessageWithoutLink({ message: tesekkur, commenterName })
        );
      } catch (error) {
        console.log("[DM Worker] Tesekkur mesaji gonderilemedi:", formatError(error));
      }
    }

    await epostaSonrasiLinkiGonder(
      job as Job<DmQueueJob>,
      accessToken,
      automation,
      senderId,
      commenterName
    );
    return true;
  }

  return false;
}

async function processPostback(job: Job<ProcessPostbackJob>): Promise<void> {
  const { instagramAccountId, userId, payload, fallback } = job.data;

  const isFollowCheck = payload.startsWith("followcheck:");
  if (!isFollowCheck && !payload.startsWith("reveal:")) return;
  const automationId = payload.slice(
    isFollowCheck ? "followcheck:".length : "reveal:".length
  );

  const automation = await prisma.automation.findFirst({
    where: { id: automationId, isActive: true },
    include: {
      instagramAccount: true,
      workspace: true,
      trackedLinks: {
        select: { slug: true, label: true, destinationUrl: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (
    !automation ||
    automation.instagramAccount.instagramId !== instagramAccountId ||
    !automation.instagramAccount.accessToken
  ) {
    return;
  }

  // Duplicate sends are enabled: every button tap re-sends the reveal
  // instead of only firing once per person.
  const dedupeId = `reveal:${userId}`;

  if (fallback) {
    const existingReveal = await prisma.dmLog.findUnique({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId: dedupeId,
        },
      },
    });
    if (existingReveal?.status === "SENT") return;
  }

  // Personalize {username} from the opening DM log for this user, if present.
  const openingLog = await prisma.dmLog.findFirst({
    where: { automationId: automation.id, commenterId: userId },
    select: { commenterName: true },
  });
  const commenterName = openingLog?.commenterName ?? null;

  let accessToken: string;
  try {
    accessToken = decryptToken(automation.instagramAccount.accessToken);
  } catch {
    return;
  }

  // Follow-gate: before revealing the link, verify the user follows. On a
  // `followcheck:` tap a non-follower gets the prompt again (no quota spent);
  // on a read fallback a non-follower is silently skipped — the gate must not
  // be bypassable by just reading the DM and waiting. Following, or
  // unverifiable (null), falls through and delivers the link — fail-open so a
  // real follower is never trapped.
  if ((isFollowCheck || fallback) && automation.requireFollow) {
    const follows = await getUserFollowStatus(accessToken, userId);
    if (follows === false) {
      if (fallback) return;
      const promptText = renderMessageWithoutLink({
        message:
          automation.followPromptMessage ||
          "quick favor before i send your link. i don't make any money from this, it's free. if you want to support me, just don't unfollow after, and star the repo on github if it helps you. tap the button once you're following and i'll send it over",
        commenterName,
      });
      try {
        await sendDirectMessageWithButton(
          accessToken,
          automation.instagramAccount.instagramId,
          userId,
          promptText,
          automation.followPromptButtonLabel || "i'm following",
          `followcheck:${automation.id}`
        );
      } catch (error) {
        console.log(
          "[DM Worker] Failed to re-send follow prompt:",
          formatError(error)
        );
      }
      return;
    }
  }

  const usage = await reserveWorkspaceDMSend(automation.workspaceId);
  if (!usage.allowed) {
    await prisma.dmLog.upsert({
      where: {
        automationId_commentId: { automationId: automation.id, commentId: dedupeId },
      },
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: userId,
        commenterName,
        commentText: "(button tap)",
        commentId: dedupeId,
        status: "SKIPPED_PLAN_LIMIT",
        errorMessage: `Monthly DM limit reached (${usage.limit})`,
      },
      update: { status: "SKIPPED_PLAN_LIMIT" },
    });
    return;
  }

  // Linki tasiyan asil DM bu yoldan gider; sinir burada da uygulanmali.
  if (!(await hizSlotuAl(instagramAccountId, job as Job<DmQueueJob>, "postback"))) return;

  try {
    await sendRevealDirectMessage(
      accessToken,
      automation,
      userId,
      commenterName,
      "postback"
    );
    // Optional appreciation follow-up: once the link has been delivered, send a
    // short thank-you. It is scheduled as its own delayed job so it can go out
    // some minutes later (followUpDelayMinutes) rather than immediately. The
    // deterministic job id dedupes repeat button taps to one follow-up per user.
    if (automation.followUpEnabled && automation.followUpMessage?.trim()) {
      const delayMs =
        Math.max(0, automation.followUpDelayMinutes ?? 0) * 60_000;
      await getDMQueue().add(
        FOLLOWUP_JOB_NAME,
        {
          instagramAccountId: automation.instagramAccount.instagramId,
          userId,
          automationId: automation.id,
          commenterName,
        },
        {
          delay: delayMs,
          jobId: `followup_${automation.id}_${userId}`,
        }
      );
    }
    await prisma.dmLog.upsert({
      where: {
        automationId_commentId: { automationId: automation.id, commentId: dedupeId },
      },
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: userId,
        commenterName,
        commentText: "(button tap)",
        commentId: dedupeId,
        status: "SENT",
        dmSentAt: new Date(),
      },
      update: { status: "SENT", dmSentAt: new Date(), errorMessage: null },
    });
  } catch (error) {
    await releaseWorkspaceDMReservation(automation.workspaceId, usage.periodStart);

    // The read fallback is speculative: it only runs when the user read the
    // opening DM and never tapped the button, which means they never messaged
    // us, which means the 24-hour window is closed and Meta rejects the send
    // ("outside of allowed window"). That is the expected outcome here, not a
    // failure the user can act on — so don't log it as FAILED and don't retry
    // it against a window that cannot reopen on its own. It still delivers in
    // the case that does work: the user replied by typing instead of tapping.
    if (fallback) {
      console.log(
        "[DM Worker] Read fallback not delivered (messaging window closed):",
        formatError(error)
      );
      return;
    }

    await prisma.dmLog.upsert({
      where: {
        automationId_commentId: { automationId: automation.id, commentId: dedupeId },
      },
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: userId,
        commenterName,
        commentText: "(button tap)",
        commentId: dedupeId,
        status: "FAILED",
        errorMessage: formatError(error),
      },
      update: { status: "FAILED", errorMessage: formatError(error) },
    });
    throw error;
  }
}

/**
 * Send the scheduled appreciation follow-up. Runs after its delay elapses.
 * Best-effort: if the message can't be delivered (e.g. the 24-hour messaging
 * window closed because the delay was long), it is logged, not retried forever.
 */
async function processFollowUp(job: Job<ProcessFollowUpJob>): Promise<void> {
  const { instagramAccountId, userId, automationId, commenterName } = job.data;

  const automation = await prisma.automation.findFirst({
    where: { id: automationId, isActive: true },
    include: { instagramAccount: true },
  });

  if (
    !automation ||
    !automation.followUpEnabled ||
    !automation.followUpMessage?.trim() ||
    automation.instagramAccount.instagramId !== instagramAccountId ||
    !automation.instagramAccount.accessToken
  ) {
    return;
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(automation.instagramAccount.accessToken);
  } catch {
    return;
  }

  if (
    !(await hizSlotuAl(
      automation.instagramAccount.instagramId,
      job as Job<DmQueueJob>,
      "followup"
    ))
  )
    return;

  try {
    await sendDirectMessage(
      accessToken,
      automation.instagramAccount.instagramId,
      userId,
      renderMessageWithoutLink({
        message: automation.followUpMessage,
        commenterName: commenterName ?? null,
      })
    );
  } catch (error) {
    console.log(
      "[DM Worker] Failed to send follow-up message:",
      formatError(error)
    );
  }
}

/**
 * Reply to an inbound DM whose text matches a campaign's keywords.
 *
 * The user has messaged us, so the conversation is already open: this path
 * skips the opening DM (which exists to work around private-reply limits from
 * comments) and delivers the reveal directly, honouring the follow gate.
 * Dedup is per inbound message id, so each message triggers at most one reply.
 */
async function processMessage(job: Job<ProcessMessageJob>): Promise<void> {
  const { instagramAccountId, messageId, messageText, senderId } = job.data;

  // E-posta kapisi anahtar kelimeden ONCE calisir: kisi adresini yaziyor olabilir
  // ve o metin hicbir anahtar kelimeyle eslesmez. Kapi mesaji ustlendiyse normal
  // akis CALISTIRILMAZ (yoksa ayni mesaja iki cevap gider).
  if (await epostaKapisiniIsle(job, instagramAccountId, senderId, messageText)) {
    return;
  }

  const automations = await prisma.automation.findMany({
    where: {
      dmTriggerEnabled: true,
      isActive: true,
      instagramAccount: { instagramId: instagramAccountId },
    },
    include: {
      instagramAccount: true,
      workspace: true,
      trackedLinks: {
        select: { slug: true, label: true, destinationUrl: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const dedupeId = `dm:${messageId}`;

  for (const automation of automations) {
    const matchResult = automation.matchAnyWord
      ? { matched: true, matchedKeyword: null }
      : matchKeywords(
          messageText,
          automation.keywords,
          automation.wholeWordMatch
        );

    if (!matchResult.matched) continue;

    const existingLog = await prisma.dmLog.findUnique({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId: dedupeId,
        },
      },
    });

    // Already replied to this message (or deliberately skipped it) — a retry
    // of the job must not send a second DM.
    if (
      existingLog?.status === "SENT" ||
      existingLog?.status === "SKIPPED_PLAN_LIMIT"
    ) {
      continue;
    }

    const logBase = {
      workspaceId: automation.workspaceId,
      automationId: automation.id,
      instagramAccountId: automation.instagramAccountId,
      commenterId: senderId,
      commentText: messageText,
      commentId: dedupeId,
      matchedKeyword: matchResult.matchedKeyword,
    };

    if (!automation.instagramAccount.accessToken) {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId: dedupeId,
          },
        },
        create: {
          ...logBase,
          status: "FAILED",
          errorMessage: "No Instagram access token available",
        },
        update: {
          status: "FAILED",
          errorMessage: "No Instagram access token available",
        },
      });
      continue;
    }

    let accessToken: string;
    try {
      accessToken = decryptToken(automation.instagramAccount.accessToken);
    } catch {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId: dedupeId,
          },
        },
        create: {
          ...logBase,
          status: "FAILED",
          errorMessage: "Failed to decrypt Instagram access token",
        },
        update: {
          status: "FAILED",
          errorMessage: "Failed to decrypt Instagram access token",
        },
      });
      continue;
    }

    // Reuse a name captured on an earlier interaction so {username} still
    // renders — the messages webhook carries only the sender's IGSID.
    const priorLog = await prisma.dmLog.findFirst({
      where: { automationId: automation.id, commenterId: senderId },
      select: { commenterName: true },
    });
    const commenterName = priorLog?.commenterName ?? null;

    // Follow gate: anyone not confirmed as a follower gets the prompt instead of
    // the link, with the same `followcheck:` button that re-verifies on tap.
    // `null` (unverifiable) prompts too — this is first contact, exactly like a
    // comment, so it follows processComment's fail-closed rule rather than the
    // postback path's fail-open one. Fail-open is only safe after a tap, where
    // the user has already claimed to follow; here it would hand the link to
    // anyone whose status the API happens not to resolve.
    let sendFollowPrompt = false;
    if (automation.requireFollow) {
      const follows = await getUserFollowStatus(accessToken, senderId);
      sendFollowPrompt = follows !== true;
    }

    const usage = await reserveWorkspaceDMSend(automation.workspaceId);
    if (!usage.allowed) {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId: dedupeId,
          },
        },
        create: {
          ...logBase,
          status: "SKIPPED_PLAN_LIMIT",
          errorMessage: `Monthly DM limit reached (${usage.limit})`,
        },
        update: {
          status: "SKIPPED_PLAN_LIMIT",
          errorMessage: `Monthly DM limit reached (${usage.limit})`,
        },
      });
      continue;
    }

    // DM-tetikleyici yolu: 30 Agustos'ta en yuksek hacim buradan aktı ve
    // hicbir hiz sayacina ugramiyordu. `continue` kullaniliyor cunku ayni
    // mesaja birden fazla kampanya eslesebilir — biri ertelenince digerleri
    // denenmeye devam etmeli.
    if (
      !(await hizSlotuAl(
        automation.instagramAccount.instagramId,
        job as Job<DmQueueJob>,
        "message"
      ))
    )
      continue;

    try {
      if (sendFollowPrompt) {
        const promptText = renderMessageWithoutLink({
          message:
            automation.followPromptMessage ||
            "Almost there! Follow me and tap the button below to grab your link 💛",
          commenterName,
        });
        await sendDirectMessageWithButton(
          accessToken,
          automation.instagramAccount.instagramId,
          senderId,
          promptText,
          automation.followPromptButtonLabel || "I'm following ✅",
          `followcheck:${automation.id}`
        );
      } else {
        await sendRevealDirectMessage(
          accessToken,
          automation,
          senderId,
          commenterName,
          "message trigger"
        );

        // The link has been delivered, so the appreciation follow-up applies
        // here exactly as it does after a button tap. Not scheduled behind the
        // follow prompt — no link went out yet in that branch.
        if (automation.followUpEnabled && automation.followUpMessage?.trim()) {
          await getDMQueue().add(
            FOLLOWUP_JOB_NAME,
            {
              instagramAccountId: automation.instagramAccount.instagramId,
              userId: senderId,
              automationId: automation.id,
              commenterName,
            },
            {
              delay: Math.max(0, automation.followUpDelayMinutes ?? 0) * 60_000,
              jobId: `followup_${automation.id}_${senderId}`,
            }
          );
        }
      }

      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId: dedupeId,
          },
        },
        create: {
          ...logBase,
          commenterName,
          status: "SENT",
          dmSentAt: new Date(),
        },
        update: {
          status: "SENT",
          dmSentAt: new Date(),
          errorMessage: null,
        },
      });
    } catch (error) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId: dedupeId,
          },
        },
        create: {
          ...logBase,
          commenterName,
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
        },
        update: {
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
        },
      });
      throw error;
    }
  }
}

export async function processJob(job: Job<DmQueueJob>): Promise<void> {
  if (job.name === POSTBACK_JOB_NAME) {
    return processPostback(job as Job<ProcessPostbackJob>);
  }
  if (job.name === FOLLOWUP_JOB_NAME) {
    return processFollowUp(job as Job<ProcessFollowUpJob>);
  }
  if (job.name === MESSAGE_JOB_NAME) {
    return processMessage(job as Job<ProcessMessageJob>);
  }
  return processComment(job as Job<ProcessCommentJob>);
}

async function recordWorkerFailure(
  job: Job<DmQueueJob> | undefined,
  error: Error
) {
  try {
    const instagramAccountId = job?.data.instagramAccountId;
    const commentId =
      job && "commentId" in job.data ? job.data.commentId : null;
    const account = instagramAccountId
      ? await prisma.instagramAccount.findUnique({
          where: { instagramId: instagramAccountId },
          select: { workspaceId: true },
        })
      : null;

    await prisma.operationalEvent.create({
      data: {
        workspaceId: account?.workspaceId ?? null,
        source: "WORKER",
        level: "ERROR",
        message: `DM worker job ${job?.id ?? "unknown"} failed: ${error.message}`,
        payload: {
          jobId: job?.id ?? null,
          attemptsMade: job?.attemptsMade ?? null,
          instagramAccountId: instagramAccountId ?? null,
          commentId,
        },
      },
    });

    await recordWorkerAlert({
      level: "error",
      message: error.message,
      jobId: job?.id,
      instagramAccountId,
      commentId: commentId ?? undefined,
    });
  } catch (recordError) {
    console.error(
      "[DM Worker] Failed to record worker failure:",
      formatError(recordError)
    );
  }
}

/**
 * Kuyrugu bosalt — BullMQ Worker'in yerini alan tek giris noktasi.
 *
 * Hem Vercel Cron (`/api/cron/drain`) hem de kendi kendine barindirma icin
 * `worker/dm-worker.ts` bunu cagirir; is mantigi (processJob) degismedi.
 *
 * `sureSiniriMs`: Vercel fonksiyonu zaman asimina ugramadan once durur. Yarim
 * kalan isler PENDING'e geri doner, bir sonraki tur devam eder — is kaybi yok.
 */
export async function kuyrugunuBosalt(opts: {
  enFazla?: number;
  sureSiniriMs?: number;
} = {}): Promise<{ alinan: number; basarili: number; basarisiz: number; sureDoldu: boolean }> {
  const enFazla = opts.enFazla ?? 25;
  const sureSiniri = opts.sureSiniriMs ?? 240_000;
  const basla = Date.now();

  const isler = await isleriKilitle(enFazla);
  let basarili = 0;
  let basarisiz = 0;
  let sureDoldu = false;

  for (const is of isler) {
    if (Date.now() - basla > sureSiniri) {
      // Kalan kilitli isleri serbest birak, yoksa takilma esigine kadar beklerler.
      await prisma.queueJob.updateMany({
        where: { id: { in: isler.slice(isler.indexOf(is)).map((x) => x.id) }, status: "ACTIVE" },
        data: { status: "PENDING", lockedAt: null },
      });
      sureDoldu = true;
      break;
    }

    // processJob BullMQ'nun Job nesnesini bekliyor; isleyiciler bu dort alandan
    // baskasini kullanmiyor (olculdu: data 8, attemptsMade 7, name 3, id 1).
    const jobBenzeri = {
      id: is.id,
      name: is.name,
      data: is.data,
      attemptsMade: is.attempts,
    } as unknown as Job<DmQueueJob>;

    try {
      await processJob(jobBenzeri);
      await isiTamamla(is.id);
      basarili++;
    } catch (error) {
      const mesaj = formatError(error);
      const sonuc = await isiBasarisizYap(is.id, is.attempts, is.maxAttempts, mesaj);
      if (sonuc === "BITTI") {
        basarisiz++;
        await recordWorkerFailure(jobBenzeri, error instanceof Error ? error : new Error(mesaj));
      }
      console.error(`[kuyruk] is ${is.id} (${is.name}) hata: ${mesaj}`);
    }
  }

  return { alinan: isler.length, basarili, basarisiz, sureDoldu };
}
