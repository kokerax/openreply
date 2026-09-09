/**
 * Eksik yorum cevaplarini tamamlar.
 *
 * DM'i giden ama altina yorum cevabi DUSMEYEN kayitlar birikiyordu (2026-09-08
 * itibariyla 229 kisi): yorum tarayicisi bunlari yalnizca kendi dar penceresi
 * icinde geri getiriyor, pencereden cikan kayit bir daha kimsenin radarina
 * girmiyor. Sebepler karisik — hiz siniri, Instagram tarafinda gecici hata, ya
 * da (CITY kampanyasinda oldugu gibi) kampanyaya hic metin girilmemis olmasi.
 *
 * Worker zaten "DM gitti ama yorum cevabi gitmedi" durumunu biliyor ve yalnizca
 * cevabi yeniden deniyor (`SENT` ezilmiyor). Bu yuzden burada yeni bir gonderim
 * yolu YAZILMIYOR — ayni isi ayni yerden yapmak icin is yeniden kuyruklaniyor.
 */
import { prisma } from "@/lib/db/client";
import { getDMQueue } from "@/lib/queue/client";

/**
 * Cok eski bir yorumun altina birden cevap dusmesi kullaniciya tuhaf gelir ve
 * toplu/otomatik gorunur. Yalnizca son bir haftaya dokunuyoruz.
 */
const PENCERE_MS = 7 * 24 * 3600_000;

/**
 * "Yavas yavas": tur basina tavan. Saatlik cron ile ~15/saat eder; ayni metnin
 * arka arkaya yagmasi Instagram'da spam sinyalidir, varyant havuzu da bu yuzden
 * var. Worker'in kendi hiz siniri (dakikalik 8) bunun ustune biner.
 */
export const YORUM_TUR_TAVANI = 15;

/**
 * Aday havuzunu tavanin kac kati cekecegiz. Bugun denenmisleri eleyip
 * tavana kadar ilerleyebilmek icin gerekli; 1 kat oldugunda tur bosa gidiyordu.
 */
const HAVUZ_KATI = 12;

export interface YorumCevabiSonucu {
  aday: number;
  kuyruklanan: number;
  kampanyalar: Record<string, number>;
}

/**
 * DM'i gitmis ama yorum cevabi eksik kayitlari yeniden kuyruklar.
 *
 * @param limit Bu turda en fazla kac kayit.
 * @param kuruDeneme true ise hicbir sey yazilmaz; sadece adaylar sayilir.
 */
export async function eksikYorumCevaplariniTamamla(
  limit: number = YORUM_TUR_TAVANI,
  kuruDeneme = false
): Promise<YorumCevabiSonucu> {
  const gun = new Date().toISOString().slice(0, 10);

  // Adaylari tavandan GENIS cek. Sebep olculdu: tavan kadar cekip gunluk
  // tekillestirme anahtari uygulayinca her tur AYNI en yeni 15 kayit
  // geliyordu; ilk turdan sonra hepsi "bugun denendi" diye eleniyor ve gun
  // boyu SIFIR is kuyruklaniyordu. 12 saatte 205 birikime karsi yalnizca 26
  // cevap gitmisti. Genis cekip bugun denenmisleri eleyerek ilerliyoruz.
  const havuz = await prisma.dmLog.findMany({
    where: {
      status: "SENT",
      isBackfill: false,
      publicReplySentAt: null,
      createdAt: { gte: new Date(Date.now() - PENCERE_MS) },
      automation: { publicReplyEnabled: true, isActive: true },
      // SADECE GERCEK YORUMLAR.
      //
      // DmLog yalnizca yorumlari tutmuyor: e-posta kapisi, takip kapisi, link
      // acilisi ve DM tetikleyicisi de kendi defter satirlarini ayni tabloya
      // yaziyor ve `commentId` alanina "emailgate:<igsid>" gibi SENTETIK bir
      // anahtar koyuyor. Bunlarin altina yazilacak bir yorum yok.
      //
      // Bu filtre olmadan modul her saat 15 sentetik satiri kuyrukluyor,
      // worker anahtar kelime eslesmedigi icin sessizce atliyor ve is hatasiz
      // "DONE" oluyordu — yani tur bosa gidiyor, hicbir sey de sikayet
      // etmiyordu. Olcum: bekleyen sanilan 205 kaydin 205'i sentetikti
      // (134 reveal, 68 emailgate, 3 dm), gercek yorum SIFIR.
      //
      // Gercek Instagram yorum kimlikleri tamamen rakamdir; sentetik olanlarin
      // hepsinde iki nokta var.
      commentId: { not: { contains: ":" } },
    },
    include: {
      automation: {
        select: { name: true, postId: true, publicReplyMessages: true },
      },
      instagramAccount: { select: { instagramId: true } },
    },
    // En yenisi once: yorum ne kadar tazeyse cevap o kadar dogal gorunur.
    orderBy: { createdAt: "desc" },
    take: limit * HAVUZ_KATI,
  });

  // Bugun zaten kuyruklanmislar elenir. `queue.add` mukerrer anahtarda null
  // dondugu icin bu olmadan da mukerrer IS olusmuyordu, ama tur bosa gidiyordu.
  const bugunDenenen = new Set(
    (
      await prisma.queueJob.findMany({
        where: { dedupeKey: { in: havuz.map((k) => `yorumcevabi:${k.id}:${gun}`) } },
        select: { dedupeKey: true },
      })
    ).map((j) => j.dedupeKey)
  );

  const adaylar = havuz
    .filter((k) => !bugunDenenen.has(`yorumcevabi:${k.id}:${gun}`))
    .slice(0, limit);

  // Metni olmayan kampanyayi kuyruklamak bosuna tur harcar: worker
  // `replyPool.length > 0` sartini gecemez ve kayit yarin yine aday olur.
  const uygun = adaylar.filter(
    (k) => k.automation.publicReplyMessages.length > 0
  );

  const sonuc: YorumCevabiSonucu = {
    aday: uygun.length,
    kuyruklanan: 0,
    kampanyalar: {},
  };

  if (kuruDeneme) {
    for (const k of uygun) {
      sonuc.kampanyalar[k.automation.name] =
        (sonuc.kampanyalar[k.automation.name] ?? 0) + 1;
    }
    return sonuc;
  }

  const queue = getDMQueue();

  for (const kayit of uygun) {
    const eklendi = await queue.add(
      "process-comment",
      {
        instagramAccountId: kayit.instagramAccount.instagramId,
        commentId: kayit.commentId,
        commentText: kayit.commentText,
        commenterId: kayit.commenterId,
        commenterName: kayit.commenterName ?? undefined,
        mediaId: kayit.automation.postId ?? "",
        source: "KURTARMA",
      },
      {
        // Gun basina tek deneme: ayni kayit her turda yeniden kuyruklanip
        // yorum bolumune ayni cevabi yagdirmasin.
        jobId: `yorumcevabi:${kayit.id}:${gun}`,
      }
    );
    // `add` mukerrer anahtarda null doner; o kayit bugun zaten denenmis.
    if (eklendi) {
      sonuc.kuyruklanan += 1;
      sonuc.kampanyalar[kayit.automation.name] =
        (sonuc.kampanyalar[kayit.automation.name] ?? 0) + 1;
    }
  }

  return sonuc;
}
