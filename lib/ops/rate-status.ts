/**
 * Hiz siniri durumu — panel icin salt-okunur goruntu.
 *
 * `lib/utils/pg-rate-limiter.ts` iki pencereyi RateCounter tablosunda tutar:
 *   burst:<accountId>  → 8 / 60 sn   (asil baglayici sinir, 2026-08-30 olcumu)
 *   hour:<accountId>   → 750 / 3600 sn (Meta'nin dokumante ettigi tavan)
 *
 * Bu modul sayaca DOKUNMAZ (rezervasyon yapmaz); sadece okur. Suresi dolmus bir
 * sayac "0 kullanildi" sayilir — limiter da ayni sekilde davranir (expiresAt
 * gecmisse sayaci 1'den baslatir). Zaman uygulamadan gelir (`new Date()`),
 * SQL'de NOW() yok: Prisma UTC yazar, NOW() oturum dilimini dondurur.
 */
import { prisma } from "@/lib/db/client";

/** pg-rate-limiter.ts'deki PATLAMA_MAX / SAATLIK_MAX ile ayni olmali. */
export const BURST_MAX = 8;
export const BURST_WINDOW_SEC = 60;
export const HOURLY_MAX = 750;
export const HOURLY_WINDOW_SEC = 3600;

export interface WindowStatus {
  used: number;
  max: number;
  /** ISO zamani; sayac bos/suresi dolmussa null. */
  resetsAt: string | null;
}

export interface AccountRateStatus {
  accountId: string;
  username: string;
  burst: WindowStatus;
  hourly: WindowStatus;
  pendingJobs: number;
}

interface CounterRow {
  key: string;
  count: number;
  expiresAt: Date;
}

/**
 * Tek sayaci pencere durumuna cevir. Saf fonksiyon — test icin disari acik.
 * Dolmus sayac = bos pencere; kullanilan hicbir zaman max'i asmaz (limiter
 * `count < max` sartiyla artirir ama eski kayitlar/elle mudahale asabilir).
 */
export function sayacOku(
  counter: CounterRow | undefined,
  now: Date,
  max: number
): WindowStatus {
  if (!counter || counter.expiresAt.getTime() <= now.getTime()) {
    return { used: 0, max, resetsAt: null };
  }
  return {
    used: Math.min(max, Math.max(0, counter.count)),
    max,
    resetsAt: counter.expiresAt.toISOString(),
  };
}

/** Kuyruk isinin verisinden hesap kimligini cikar; sekil bilinmiyorsa null. */
export function isHesabi(data: unknown): string | null {
  if (data && typeof data === "object" && "instagramAccountId" in data) {
    const id = (data as { instagramAccountId?: unknown }).instagramAccountId;
    return typeof id === "string" ? id : null;
  }
  return null;
}

/**
 * Hesap basina hiz siniri durumu. `instagramAccountId` verilirse tek hesap,
 * verilmezse `workspaceId` altindaki tum hesaplar (o da yoksa hepsi — sadece
 * ops/CLI kullanimi icin; API her zaman workspace verir).
 */
export async function hizDurumu(
  instagramAccountId?: string,
  workspaceId?: string
): Promise<AccountRateStatus[]> {
  const accounts = await prisma.instagramAccount.findMany({
    where: {
      ...(workspaceId ? { workspaceId } : {}),
      ...(instagramAccountId ? { id: instagramAccountId } : {}),
    },
    orderBy: { connectedAt: "desc" },
    select: { id: true, username: true },
  });
  if (accounts.length === 0) return [];

  const keys = accounts.flatMap((a) => [`burst:${a.id}`, `hour:${a.id}`]);
  const [counters, pendingJobs] = await Promise.all([
    prisma.rateCounter.findMany({
      where: { key: { in: keys } },
      select: { key: true, count: true, expiresAt: true },
    }),
    prisma.queueJob.findMany({
      where: { status: "PENDING" },
      select: { data: true },
    }),
  ]);

  const now = new Date();
  const byKey = new Map<string, CounterRow>(counters.map((c) => [c.key, c]));
  const pendingByAccount = new Map<string, number>();
  for (const job of pendingJobs) {
    const id = isHesabi(job.data);
    if (id) pendingByAccount.set(id, (pendingByAccount.get(id) ?? 0) + 1);
  }

  return accounts.map((a) => ({
    accountId: a.id,
    username: a.username,
    burst: sayacOku(byKey.get(`burst:${a.id}`), now, BURST_MAX),
    hourly: sayacOku(byKey.get(`hour:${a.id}`), now, HOURLY_MAX),
    pendingJobs: pendingByAccount.get(a.id) ?? 0,
  }));
}
