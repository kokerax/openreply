/**
 * Blok sonrasi kurtarma
 *
 * Instagram hesabi gecici olarak mesajlasmadan engellendiginde (Meta 368,
 * ya da private reply icin `sub=2534025`) o anda yorum yazan herkes
 * `DmLog.status = FAILED` olarak kaydediliyor ve bir daha ASLA denenmiyor:
 * yorum tarayicisi yalnizca dar bir pencereye (`COMMENT_POLL_LOOKBACK_HOURS`)
 * bakiyor, o pencere gectikten sonra kayit kimsenin radarina girmiyor.
 *
 * 2026-09-06 21:57 UTC ile 2026-09-08 15:01 UTC arasinda bu sekilde 52 kisi
 * kayboldu; teslimat denetimi durumu Telegram'a bildirdi ama kimse yeniden
 * denenmedi. Bu modul o bosluğu kapatir.
 *
 * Neden yeniden denemek guvenli: engel hesap seviyesindedir, yorumun tek
 * private-reply hakkini YAKMAZ. Kanit — ulaskonu16'nin yorumu ilk denemede
 * (attempts=1) `sub=2534025` aldi; el ile yapilan ikinci deneme de ayni hatayi
 * dondu, "zaten yanitlandi" demedi.
 */
import { prisma } from "@/lib/db/client";
import { getDMQueue } from "@/lib/queue/client";

/**
 * Instagram'in private reply penceresi 7 gun. 6 gunde kesiyoruz ki is
 * kuyrukta beklerken suresi dolmasin — dolmus bir yorumu yeniden denemek
 * sadece gurultu uretir.
 */
const PENCERE_MS = 6 * 24 * 3600_000;

/** Bir kayit sonsuza kadar denenmesin; blok gunlerce surerse de durur. */
const MAX_KURTARMA_DENEMESI = 6;

/**
 * Blok kalktigi anda birikmis yigin tek seferde bosalirsa Instagram ayni
 * kisitlamayi yeniden koyabilir. Saatlik tavan bu yuzden bilerek dusuk;
 * worker'in kendi hiz siniri (dakikalik 8 / saatlik 750) bunun ustune biner.
 */
export const SWEEP_TAVANI = 10;

/**
 * Yalnizca GECICI redler. Kalici olanlar ("requested user cannot be found",
 * "outside of allowed window") bilerek disarida: onlari yeniden denemek her
 * seferinde ayni sonucu verir ve kotayi bosa harcar.
 */
const GECICI_HATA_IMZALARI = ["sub=2534025", "code=368", "temporarily blocked"];

export interface KurtarmaSonucu {
  aday: number;
  kuyruklanan: number;
  ornekler: { kisi: string | null; kampanya: string; yas_saat: number }[];
}

/**
 * Gecici blok yuzunden dusmus gonderimleri yeniden kuyruga alir.
 *
 * @param limit Bu turda en fazla kac kayit kuyruklanacak.
 * @param kuruDeneme true ise hicbir sey yazilmaz, sadece adaylar raporlanir.
 */
export async function bloktanKurtar(
  limit: number = SWEEP_TAVANI,
  kuruDeneme = false
): Promise<KurtarmaSonucu> {
  const simdi = Date.now();

  const adaylar = await prisma.dmLog.findMany({
    where: {
      status: "FAILED",
      isBackfill: false,
      createdAt: { gte: new Date(simdi - PENCERE_MS) },
      attempts: { lt: MAX_KURTARMA_DENEMESI },
      OR: GECICI_HATA_IMZALARI.map((imza) => ({
        errorMessage: { contains: imza },
      })),
    },
    include: {
      automation: {
        select: { id: true, name: true, isActive: true, postId: true },
      },
      instagramAccount: { select: { instagramId: true } },
    },
    // En yenisi once: private reply penceresi en genis olan, kisi de en taze.
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  // Duraklatilmis kampanyanin kaydini diriltme — kullanici bilerek kapatmistir.
  const uygun = adaylar.filter((k) => k.automation.isActive);

  const sonuc: KurtarmaSonucu = {
    aday: uygun.length,
    kuyruklanan: 0,
    ornekler: uygun.slice(0, 5).map((k) => ({
      kisi: k.commenterName,
      kampanya: k.automation.name,
      yas_saat: Math.round((simdi - k.createdAt.getTime()) / 3600_000),
    })),
  };

  if (kuruDeneme) return sonuc;

  const queue = getDMQueue();

  for (const kayit of uygun) {
    // `attempts` once artiyor: kuyruklama basarili olup gonderim yine duserse
    // sayac ilerlemis olur ve kayit MAX_KURTARMA_DENEMESI'nde durur. Ters sira
    // (once kuyrukla, sonra say) blok surerken sonsuz donguye yol acardi.
    await prisma.dmLog.update({
      where: { id: kayit.id },
      data: { attempts: { increment: 1 } },
    });

    await queue.add(
      "process-comment",
      {
        instagramAccountId: kayit.instagramAccount.instagramId,
        commentId: kayit.commentId,
        commentText: kayit.commentText,
        commenterId: kayit.commenterId,
        commenterName: kayit.commenterName ?? undefined,
        // Kampanya bir gonderiye bagliysa worker'in secim sorgusu
        // (`postId: mediaId`) eslessin diye onun postId'si veriliyor;
        // `matchAnyPost` kampanyalarda bu deger zaten kullanilmiyor.
        mediaId: kayit.automation.postId ?? "",
        source: "KURTARMA",
      },
      {
        // Ayni kayit icin ayni turda ikinci is olusmasin; sonraki turda
        // sayac degistigi icin anahtar da degisir.
        jobId: `kurtarma:${kayit.id}:${kayit.attempts + 1}`,
      }
    );
    sonuc.kuyruklanan += 1;
  }

  return sonuc;
}
