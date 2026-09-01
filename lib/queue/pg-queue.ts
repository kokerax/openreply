/**
 * Postgres tabanli kuyruk — BullMQ/Redis'in yerini alir.
 *
 * NEDEN: BullMQ tuketicisi 7/24 acik bir Node sureci ister ve bu Vercel'de
 * calismaz; ayri bir sunucu (ve ayri bir Redis) gerektiriyordu. Isler artik
 * Postgres'te durur ve Vercel Cron tarafindan bosaltilir, boylece sistem
 * Vercel + Supabase ikilisine siger.
 *
 * BullMQ semantiginden korunanlar:
 * - `.add(name, data, { delay, jobId })` imzasi AYNEN ayni, boylece 13 cagri
 *   yerinin hicbiri degismedi.
 * - `jobId` -> `dedupeKey`: ayni anahtarla ikinci ekleme sessizce yok sayilir.
 * - `delay` -> `runAt`.
 * - 3 deneme + artan bekleme (BACKOFF_DELAYS ile ayni degerler).
 * - Tamamlanan/basarisiz isler bir sure sonra silinir; BullMQ'daki
 *   removeOnComplete/removeOnFail'in amaci aynidir: ayni dedupeKey'in ileride
 *   yeniden kuyruga girebilmesi.
 */
import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/app/generated/prisma/client";

export interface AddOptions {
  /** Milisaniye cinsinden gecikme (BullMQ `delay`). */
  delay?: number;
  /** Tekillestirme anahtari (BullMQ `jobId`). */
  jobId?: string;
  attempts?: number;
}

/** Isleyicilerin `job` nesnesinden kullandigi TEK alanlar bunlar. */
export interface QueueJobView<T = unknown> {
  id: string;
  name: string;
  data: T;
  attemptsMade: number;
}

export class PgQueue<T = unknown> {
  async add(name: string, data: T, opts: AddOptions = {}): Promise<{ id: string } | null> {
    const runAt = new Date(Date.now() + (opts.delay ?? 0));
    const kayit: Prisma.QueueJobCreateInput = {
      name,
      data: data as Prisma.InputJsonValue,
      runAt,
      maxAttempts: opts.attempts ?? 3,
      ...(opts.jobId ? { dedupeKey: opts.jobId } : {}),
    };

    if (!opts.jobId) {
      const olusan = await prisma.queueJob.create({ data: kayit, select: { id: true } });
      return olusan;
    }

    // BullMQ, ayni jobId ile eklemeyi sessizce yok sayar. Ayni davranis:
    // catir catir hata firlatmak yerine mevcut isi birak.
    try {
      return await prisma.queueJob.create({ data: kayit, select: { id: true } });
    } catch (error) {
      const kod = (error as { code?: string })?.code;
      if (kod === "P2002") return null; // dedupeKey zaten var
      throw error;
    }
  }

  /** Saglik ucu icin: BullMQ getJobCounts karsiligi. */
  async getJobCounts(...durumlar: string[]): Promise<Record<string, number>> {
    const gruplar = await prisma.queueJob.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    const simdi = new Date();
    const bekleyen = await prisma.queueJob.count({
      where: { status: "PENDING", runAt: { lte: simdi } },
    });
    const gecikmeli = await prisma.queueJob.count({
      where: { status: "PENDING", runAt: { gt: simdi } },
    });
    const harita: Record<string, number> = {
      waiting: bekleyen,
      delayed: gecikmeli,
      active: gruplar.find((g) => g.status === "ACTIVE")?._count._all ?? 0,
      failed: gruplar.find((g) => g.status === "FAILED")?._count._all ?? 0,
      paused: 0,
      completed: gruplar.find((g) => g.status === "DONE")?._count._all ?? 0,
    };
    if (durumlar.length === 0) return harita;
    return Object.fromEntries(durumlar.map((d) => [d, harita[d] ?? 0]));
  }
}

/**
 * Vadesi gelmis isleri kilitleyerek al.
 *
 * `FOR UPDATE SKIP LOCKED` sart: Vercel ayni cron'u ust uste tetikleyebilir ve
 * kilitsiz iki cagri ayni isi alip ayni kisiye iki DM yollardi.
 *
 * Takilmis isler (ACTIVE ama uzun suredir dokunulmamis) geri alinir: bir cron
 * cagrisi zaman asimina ugrarsa is sonsuza dek ACTIVE kalmamali.
 */
export async function isleriKilitle(limit: number, takilmaDk = 10): Promise<
  { id: string; name: string; data: unknown; attempts: number; maxAttempts: number }[]
> {
  // ⚠️ SQL'de NOW() KULLANMA. Prisma `DateTime`'i `timestamp WITHOUT time zone`
  // sutununa UTC olarak yazar; NOW() ise oturumun saat dilimini (burada
  // Europe/Istanbul) dondurur. Ikisini karsilastirmak sunucu saatine gore
  // sabit bir kayma uretir — +03'te NOW() UC SAAT ileri gorunur ve uc saatten
  // kisa HER gecikme aninda tetiklenir. Saatler sonrasina planlanan takip DM'i
  // hemen giderdi. Zamani uygulamadan parametre gecmek bu farki tamamen kaldirir.
  const simdi = new Date();
  const takilmaEsigi = new Date(Date.now() - takilmaDk * 60_000);
  return prisma.$queryRaw`
    UPDATE "QueueJob" SET status = 'ACTIVE', "lockedAt" = ${simdi}
    WHERE id IN (
      SELECT id FROM "QueueJob"
      WHERE (status = 'PENDING' AND "runAt" <= ${simdi})
         OR (status = 'ACTIVE' AND "lockedAt" < ${takilmaEsigi})
      ORDER BY "runAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, name, data, attempts, "maxAttempts"
  `;
}

export async function isiTamamla(id: string): Promise<void> {
  await prisma.queueJob.update({
    where: { id },
    data: { status: "DONE", completedAt: new Date(), lastError: null },
  });
}

/** Artan bekleme — BullMQ'daki BACKOFF_DELAYS ile ayni degerler. */
const BEKLEME_MS = [5 * 60_000, 15 * 60_000, 45 * 60_000];

export async function isiBasarisizYap(
  id: string,
  deneme: number,
  maxDeneme: number,
  hata: string
): Promise<"YENIDEN" | "BITTI"> {
  const yeniDeneme = deneme + 1;
  if (yeniDeneme >= maxDeneme) {
    await prisma.queueJob.update({
      where: { id },
      data: { status: "FAILED", attempts: yeniDeneme, lastError: hata.slice(0, 500), completedAt: new Date() },
    });
    return "BITTI";
  }
  const bekle = BEKLEME_MS[Math.min(yeniDeneme - 1, BEKLEME_MS.length - 1)];
  await prisma.queueJob.update({
    where: { id },
    data: {
      status: "PENDING",
      attempts: yeniDeneme,
      runAt: new Date(Date.now() + bekle),
      lockedAt: null,
      lastError: hata.slice(0, 500),
    },
  });
  return "YENIDEN";
}

/**
 * Eski kayitlari temizle.
 *
 * Sadece yer acmak icin degil: dedupeKey benzersiz oldugu icin tamamlanmis bir
 * is silinmezse ayni yorum bir daha ASLA kuyruga giremez. BullMQ'da bunu
 * removeOnComplete/removeOnFail yapiyordu, ayni sureleri kullaniyoruz.
 */
export async function eskileriTemizle(): Promise<{ done: number; failed: number }> {
  const done = await prisma.queueJob.deleteMany({
    where: { status: "DONE", completedAt: { lt: new Date(Date.now() - 24 * 3600_000) } },
  });
  const failed = await prisma.queueJob.deleteMany({
    where: { status: "FAILED", completedAt: { lt: new Date(Date.now() - 300_000) } },
  });
  return { done: done.count, failed: failed.count };
}

/* ───────────────────────── Yonetim yardimcilari (panel) ──────────────────────
 * Asagidakiler /api/admin/queue icin eklendi. Yukaridaki fonksiyonlar
 * degistirilmedi (uretim + testler onlara bagli). Zaman her yerde uygulamadan
 * parametre olarak gecilir — SQL'de NOW() yok (bkz. isleriKilitle notu).
 */

/**
 * ACTIVE bir isin "takilmis" sayilmasi icin gecmesi gereken sure (dakika).
 * `isleriKilitle(limit, takilmaDk = 10)`'daki varsayilanla AYNI deger; oradaki
 * imza degistirilmedigi icin burada ayrica adlandiriliyor. Ikisini birlikte
 * degistir.
 */
export const TAKILMA_ESIGI_DK = 10;

export type YonetimIsDurumu = "PENDING" | "ACTIVE" | "DONE" | "FAILED";

/** Panelin varsayilan filtresi: bitmemis isler. */
export const BITMEMIS_DURUMLAR: YonetimIsDurumu[] = ["PENDING", "ACTIVE", "FAILED"];

export interface YonetimIsi {
  id: string;
  name: string;
  data: unknown;
  status: YonetimIsDurumu;
  dedupeKey: string | null;
  runAt: Date;
  attempts: number;
  maxAttempts: number;
  lockedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

/**
 * Isin hangi Instagram hesabina ait oldugunu `data`'dan okur. Dort is tipi de
 * (`ProcessCommentJob`, `ProcessPostbackJob`, `ProcessFollowUpJob`,
 * `ProcessMessageJob`) bu alani tasir; tasimayan bir kayit hicbir calisma
 * alanina ait sayilmaz (null).
 */
export function isinHesabi(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const deger = (data as { instagramAccountId?: unknown }).instagramAccountId;
  return typeof deger === "string" && deger.length > 0 ? deger : null;
}

/** Is, verilen hesaplardan birine mi ait? Hesapsiz is -> false (sizdirma). */
export function isCalismaAlaninaAitMi(data: unknown, hesapIdleri: string[]): boolean {
  const hesap = isinHesabi(data);
  return hesap !== null && hesapIdleri.includes(hesap);
}

/** Prisma JSON filtresi: data.instagramAccountId IN (hesaplar). */
function hesapFiltresi(hesapIdleri: string[]): Prisma.QueueJobWhereInput {
  return {
    OR: hesapIdleri.map((id) => ({
      data: { path: ["instagramAccountId"], equals: id },
    })),
  };
}

const YONETIM_SECIMI = {
  id: true,
  name: true,
  data: true,
  status: true,
  dedupeKey: true,
  runAt: true,
  attempts: true,
  maxAttempts: true,
  lockedAt: true,
  lastError: true,
  createdAt: true,
  completedAt: true,
} as const;

/**
 * Calisma alaninin hesaplarina ait isleri listele.
 * Hesap listesi bossa sorgu bile atilmaz: bos OR Prisma'da "hepsi" degil ama
 * niyeti acikca kodlamak daha guvenli.
 */
export async function isleriListele(opts: {
  hesapIdleri: string[];
  durumlar?: YonetimIsDurumu[];
  limit?: number;
}): Promise<YonetimIsi[]> {
  if (opts.hesapIdleri.length === 0) return [];
  const durumlar = opts.durumlar?.length ? opts.durumlar : BITMEMIS_DURUMLAR;
  const kayitlar = await prisma.queueJob.findMany({
    where: { status: { in: durumlar }, ...hesapFiltresi(opts.hesapIdleri) },
    orderBy: [{ runAt: "desc" }],
    take: Math.min(Math.max(opts.limit ?? 100, 1), 500),
    select: YONETIM_SECIMI,
  });
  return kayitlar as YonetimIsi[];
}

/** Tek isi getir (sahiplik kontrolu icin data dahil). */
export async function isiGetir(id: string): Promise<YonetimIsi | null> {
  const kayit = await prisma.queueJob.findUnique({ where: { id }, select: YONETIM_SECIMI });
  return (kayit as YonetimIsi | null) ?? null;
}

/** Retry: PENDING'e cek, hemen calissin, deneme sayaci sifir, kilit yok. */
export async function isiYenidenKuyrukla(id: string, simdi = new Date()): Promise<void> {
  await prisma.queueJob.update({
    where: { id },
    data: { status: "PENDING", runAt: simdi, attempts: 0, lockedAt: null, completedAt: null },
  });
}

export async function isiSil(id: string): Promise<void> {
  await prisma.queueJob.delete({ where: { id } });
}

/** Toplu retry: calisma alaninin FAILED isleri. Kac is etkilendi doner. */
export async function basarisizlariYenidenKuyrukla(
  hesapIdleri: string[],
  simdi = new Date()
): Promise<number> {
  if (hesapIdleri.length === 0) return 0;
  const sonuc = await prisma.queueJob.updateMany({
    where: { status: "FAILED", ...hesapFiltresi(hesapIdleri) },
    data: { status: "PENDING", runAt: simdi, attempts: 0, lockedAt: null, completedAt: null },
  });
  return sonuc.count;
}

/** Toplu temizlik: N gunden eski DONE isler. Kac is silindi doner. */
export async function eskiTamamlananlariSil(
  hesapIdleri: string[],
  gunOnce = 7,
  simdi = new Date()
): Promise<number> {
  if (hesapIdleri.length === 0) return 0;
  const esik = new Date(simdi.getTime() - gunOnce * 24 * 3600_000);
  const sonuc = await prisma.queueJob.deleteMany({
    where: { status: "DONE", completedAt: { lt: esik }, ...hesapFiltresi(hesapIdleri) },
  });
  return sonuc.count;
}

/** ACTIVE olup kilidi esikten eski isler — cron zaman asimina ugramis demek. */
export async function takilanIsSayisi(
  hesapIdleri: string[],
  simdi = new Date(),
  takilmaDk = TAKILMA_ESIGI_DK
): Promise<number> {
  if (hesapIdleri.length === 0) return 0;
  const esik = new Date(simdi.getTime() - takilmaDk * 60_000);
  return prisma.queueJob.count({
    where: { status: "ACTIVE", lockedAt: { lt: esik }, ...hesapFiltresi(hesapIdleri) },
  });
}
