/**
 * Kendi kendine barindirma girisi.
 *
 * Vercel'de bu surece gerek yok — isler `/api/cron/drain` ve
 * `/api/cron/poll-comments` uclarindan yurur. Bu dosya, kendi sunucusunda
 * calistirmak isteyenler icin AYNI fonksiyonlari bir dongude cagirir; is
 * mantigi tek yerde kalir, iki kopya olmaz.
 */
import { kuyrugunuBosalt } from "@/lib/queue/dm-worker";
import { recordWorkerHeartbeat } from "@/lib/ops/worker-health";
import { reconcileComments } from "@/lib/polling/comment-reconciler";
import { eskileriTemizle } from "@/lib/queue/pg-queue";
import { sayaclariTemizle } from "@/lib/utils/pg-rate-limiter";
import os from "node:os";

const BOSALTMA_ARALIGI_MS = 5_000;
const KALP_ATISI_MS = 30_000;
const YOKLAMA_ARALIGI_MS = Number(process.env.COMMENT_POLL_INTERVAL_MS ?? 5 * 60_000);
const basladi = new Date().toISOString();

async function kalpAtisi() {
  try {
    await recordWorkerHeartbeat({ pid: process.pid, hostname: os.hostname(), startedAt: basladi });
  } catch (e) {
    console.error("[worker] kalp atisi yazilamadi:", (e as Error).message);
  }
}

async function dongu() {
  for (;;) {
    try {
      const s = await kuyrugunuBosalt({ enFazla: 25, sureSiniriMs: 60_000 });
      if (s.alinan === 0) await new Promise((r) => setTimeout(r, BOSALTMA_ARALIGI_MS));
    } catch (e) {
      console.error("[worker] bosaltma hatasi:", (e as Error).message);
      await new Promise((r) => setTimeout(r, BOSALTMA_ARALIGI_MS));
    }
  }
}

void kalpAtisi();
setInterval(() => void kalpAtisi(), KALP_ATISI_MS);
setInterval(() => {
  void reconcileComments().catch((e) => console.error("[worker] yoklama:", e.message));
  void eskileriTemizle().catch(() => {});
}, YOKLAMA_ARALIGI_MS);

console.log("[worker] basladi (Postgres kuyrugu)");
void dongu();
