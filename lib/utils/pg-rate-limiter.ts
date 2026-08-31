/**
 * Hiz siniri — Postgres sayaclariyla (Redis INCR/EXPIRE yerine).
 *
 * Iki pencere birlikte calisir:
 *
 * 1) SAATLIK 750: Meta'nin dokumante ettigi ozel yanit tavani.
 * 2) DAKIKALIK 8: asil baglayici sinir. 2026-08-30'da olculdu — o gunun tum
 *    gonderimleri dakikaya gore gruplandiginda 20+/dk'da hata orani %26,1,
 *    altindaki her bantta %0-2,8 cikti. 54 hatanin 48'i yalnizca 4 dakikada
 *    olusmustu; saatlik toplam (170) tavanin cok altindaydi.
 *
 * Patlama gatesi saatlik slottan ONCE bakilir: yoksa patlamada engellenen is,
 * hic kullanamayacagi saatlik slotu tuketir.
 */
import { prisma } from "@/lib/db/client";

const SAATLIK_MAX = 750;
const SAATLIK_PENCERE_SN = 3600;
const SAATLIK_BEKLEME_MS = 30 * 60_000;
const MAX_TEKRAR = 3;

const PATLAMA_MAX = 8;
const PATLAMA_PENCERE_SN = 60;
const PATLAMA_BEKLEME_MS = 65_000;
/**
 * Patlama beklemesi bir dakikadir, saatlik engelin 3 tekrar hakki burada cok
 * az kalir: 45 kisilik bir dalga uc dakikada hakki tuketip kuyrukta kalan
 * herkesi sessizce duserdi. 30 tekrar ~yarim saat sabir demek.
 */
const PATLAMA_MAX_TEKRAR = 30;

export interface RateLimitResult {
  allowed: boolean;
  currentCount: number;
  remainingDMs: number;
  shouldRequeue: boolean;
  requeueDelayMs: number;
  shouldSkip: boolean;
  reserved: boolean;
}

/**
 * Bir slotu ATOMIK olarak ayirt.
 *
 * Tek ifadede yapilir: iki es zamanli cron cagrisi ayni anda okuyup ayni anda
 * yazarsa sinir asilirdi. `ON CONFLICT ... WHERE` sarti sayaci yalnizca tavanin
 * altindayken artirir; dondurulen satir yoksa slot yok demektir.
 */
async function slotAyirt(
  anahtar: string,
  max: number,
  pencereSn: number
): Promise<{ alindi: boolean; sayi: number }> {
  // ⚠️ NOW() KULLANILMIYOR: Prisma bu sutunlara UTC yazar ama NOW() oturumun
  // saat dilimini dondurur (+03'te uc saat ileri). Sayaclar suresi dolmadan
  // sifirlanmis gorunur ve hiz siniri sessizce delinir. Zaman uygulamadan gelir.
  const simdi = new Date();
  const sonEr = new Date(simdi.getTime() + pencereSn * 1000);
  const sonuc = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateCounter" ("key", "count", "expiresAt")
    VALUES (${anahtar}, 1, ${sonEr})
    ON CONFLICT ("key") DO UPDATE
      SET "count" = CASE
            WHEN "RateCounter"."expiresAt" <= ${simdi} THEN 1
            ELSE "RateCounter"."count" + 1
          END,
          "expiresAt" = CASE
            WHEN "RateCounter"."expiresAt" <= ${simdi} THEN ${sonEr}
            ELSE "RateCounter"."expiresAt"
          END
      WHERE "RateCounter"."expiresAt" <= ${simdi}
         OR "RateCounter"."count" < ${max}
    RETURNING "count"
  `;
  if (sonuc.length === 0) {
    const mevcut = await prisma.rateCounter.findUnique({ where: { key: anahtar } });
    return { alindi: false, sayi: mevcut?.count ?? max };
  }
  return { alindi: true, sayi: Number(sonuc[0].count) };
}

function engellendi(sayi: number, beklemeMs: number, tekrar: number, maxTekrar: number): RateLimitResult {
  if (tekrar >= maxTekrar) {
    return {
      allowed: false, currentCount: sayi, remainingDMs: 0,
      shouldRequeue: false, requeueDelayMs: 0, shouldSkip: true, reserved: false,
    };
  }
  return {
    allowed: false, currentCount: sayi, remainingDMs: 0,
    shouldRequeue: true, requeueDelayMs: beklemeMs, shouldSkip: false, reserved: false,
  };
}

export async function reserveDMSlot(
  instagramAccountId: string,
  requeueAttempt: number = 0
): Promise<RateLimitResult> {
  const patlama = await slotAyirt(
    `burst:${instagramAccountId}`,
    PATLAMA_MAX,
    PATLAMA_PENCERE_SN
  );
  if (!patlama.alindi) {
    return engellendi(patlama.sayi, PATLAMA_BEKLEME_MS, requeueAttempt, PATLAMA_MAX_TEKRAR);
  }

  const saatlik = await slotAyirt(
    `hour:${instagramAccountId}`,
    SAATLIK_MAX,
    SAATLIK_PENCERE_SN
  );
  if (!saatlik.alindi) {
    return engellendi(saatlik.sayi, SAATLIK_BEKLEME_MS, requeueAttempt, MAX_TEKRAR);
  }

  return {
    allowed: true,
    currentCount: saatlik.sayi,
    remainingDMs: Math.max(0, SAATLIK_MAX - saatlik.sayi),
    shouldRequeue: false,
    requeueDelayMs: 0,
    shouldSkip: false,
    reserved: true,
  };
}

export async function checkRateLimit(
  instagramAccountId: string,
  requeueAttempt: number = 0
): Promise<RateLimitResult> {
  const kayit = await prisma.rateCounter.findUnique({
    where: { key: `hour:${instagramAccountId}` },
  });
  const sayi = kayit && kayit.expiresAt > new Date() ? kayit.count : 0;
  if (sayi >= SAATLIK_MAX) {
    return engellendi(sayi, SAATLIK_BEKLEME_MS, requeueAttempt, MAX_TEKRAR);
  }
  return {
    allowed: true, currentCount: sayi, remainingDMs: SAATLIK_MAX - sayi,
    shouldRequeue: false, requeueDelayMs: 0, shouldSkip: false, reserved: false,
  };
}

export async function incrementDMCounter(instagramAccountId: string): Promise<number> {
  const r = await reserveDMSlot(instagramAccountId, MAX_TEKRAR);
  return r.currentCount;
}

/** Suresi dolmus sayaclari sil — Redis'te TTL yapiyordu, burada elle. */
export async function sayaclariTemizle(): Promise<number> {
  const r = await prisma.rateCounter.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return r.count;
}
