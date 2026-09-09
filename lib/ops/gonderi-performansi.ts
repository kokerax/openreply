/**
 * Gonderi bazinda performans — hangi gonderi donusturuyor.
 *
 * Kampanyalarin cogu `matchAnyPost` ile calisiyor, yani TEK bir kampanya
 * onlarca gonderiyi kapsiyor. Panel kampanya bazinda olcuyordu; "hangi reel
 * ise yariyor" sorusu hicbir yerde cevaplanmiyordu.
 *
 * Veri 2026-09-09'da `DmLog.mediaId` eklenince olustu. Kalibrasyon (canli,
 * son 30 gun): 21 farkli gonderi, en iyisi 126 DM, ikincisi 117, sonra uzun
 * kuyruk — yani dagilim GERCEK, metrik ayirt ediyor. Iki reklam kopyasi da
 * net ayrisiyor (18 ve 13 DM, hepsi reklamdan).
 */
import { prisma } from "@/lib/db/client";
import { getMediaById } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { SADECE_YORUM } from "@/lib/queue/dmlog-kayit-turu";

/** Kac gonderi gosterilecek. Her biri bir Graph API cagrisi demek. */
export const GONDERI_TAVANI = 8;

export interface GonderiSatiri {
  mediaId: string;
  /** Yorum bir reklam kopyasindan geldiyse true. */
  reklam: boolean;
  dm: number;
  /** Instagram'daki adres; medya silinmis/erisilemezse null. */
  permalink: string | null;
  thumbnail: string | null;
  caption: string | null;
  timestamp: string | null;
}

export interface GonderiPerformansi {
  satirlar: GonderiSatiri[];
  /** Kac gonderi bulundu (tavandan once). Koruma araci kac birim isledigini yazar. */
  toplamGonderi: number;
  /** Medyasi cozulemeyen satir sayisi — sessizce dusurmek yerine raporlanir. */
  cozulemeyen: number;
}

export async function gonderiPerformansi(
  workspaceId: string,
  from: Date,
  toExclusive: Date,
  instagramAccountId?: string
): Promise<GonderiPerformansi> {
  const gruplar = await prisma.dmLog.groupBy({
    by: ["mediaId", "originalMediaId"],
    where: {
      workspaceId,
      // Goc muhurleri bu sistemin gonderimi degil.
      isBackfill: false,
      status: "SENT",
      // Defter satirlarinin medyasi YOKTUR; yorum sayan sorgu onlari eler.
      ...SADECE_YORUM,
      mediaId: { not: null },
      createdAt: { gte: from, lt: toExclusive },
      ...(instagramAccountId ? { instagramAccountId } : {}),
    },
    _count: { _all: true },
  });

  const siralanmis = gruplar
    .map((g) => ({
      mediaId: g.mediaId as string,
      reklam: Boolean(g.originalMediaId),
      dm: g._count._all,
    }))
    .sort((a, b) => b.dm - a.dm);

  const ustler = siralanmis.slice(0, GONDERI_TAVANI);

  // Token yoksa sayilar yine dondurulur, yalnizca medya ayrintisi bos kalir:
  // "hangi gonderi" sorusunun cevabi kismen de olsa gorunur olmali.
  const hesap = await prisma.instagramAccount.findFirst({
    where: { workspaceId, ...(instagramAccountId ? { id: instagramAccountId } : {}) },
    select: { accessToken: true },
  });
  let token: string | null = null;
  if (hesap) {
    try {
      token = decryptToken(hesap.accessToken);
    } catch {
      token = null;
    }
  }

  const satirlar: GonderiSatiri[] = await Promise.all(
    ustler.map(async (u) => {
      const m = token ? await getMediaById(token, u.mediaId) : null;
      return {
        ...u,
        permalink: m?.permalink ?? null,
        thumbnail: m?.thumbnail_url ?? m?.media_url ?? null,
        caption: m?.caption ? m.caption.slice(0, 90) : null,
        timestamp: m?.timestamp ?? null,
      };
    })
  );

  return {
    satirlar,
    toplamGonderi: siralanmis.length,
    cozulemeyen: satirlar.filter((s) => s.permalink === null).length,
  };
}
