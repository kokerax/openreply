/**
 * E-posta kapisi hunisi — "adres istedik, kac kisi verdi".
 *
 * Kampanya e-posta kapisi aciksa kisiye once adres soruluyor, adres gelince
 * link teslim ediliyor. Bu akisin ORTASI hicbir yerde gorunmuyordu: panel
 * yalnizca toplanan adresleri (Leads) gosteriyor, adres istenip GELMEYENLERI
 * hic saymiyordu. Yani sizintinin buyuklugu olculemiyordu.
 *
 * Kalibrasyon (canli, 2026-09-09): GTA VI 114 soruldu / 61 verdi (%53,5),
 * CITY 15 / 7 (%46,7). Ne tavana ne tabana yapisik — metrik ayirt ediyor.
 * Capraz kontrol: `emailgate` SENT sayisi (68) Lead tablosuyla BIREBIR ayni.
 *
 * DIKKAT — `followgate:` icin ayni hesap YAPILAMAZ. O satir yalnizca
 * PENDING olarak yaziliyor ve istem sayaci olarak artiriliyor; hicbir kod
 * onu SENT'e cevirmiyor. "0 gecti / 6 acik" bir urun gercegi degil, olcum
 * artefaktidir. Bu yuzden bu modul YALNIZCA e-posta kapisini raporlar.
 */
import { prisma } from "@/lib/db/client";
import { sadeceTur } from "@/lib/queue/dmlog-kayit-turu";

export interface KapiSatiri {
  automationId: string;
  automationName: string;
  /** Adres istenen kisi sayisi (verdi + acik). */
  soruldu: number;
  /** Adresi alinmis: defter satiri SENT. */
  verdi: number;
  /** Hala bekleyen: defter satiri PENDING. */
  acik: number;
  /** verdi / soruldu, yuzde, tek ondalik. Soruldu 0 ise 0. */
  oran: number;
}

export interface KapiHunisi {
  satirlar: KapiSatiri[];
  toplam: { soruldu: number; verdi: number; acik: number; oran: number };
  /**
   * SENT/PENDING disinda bir durumda kalan defter satirlari. Bugun sifir ama
   * sessizce dusurmuyoruz: bir koruma araci kac birim isledigini HEP yazmali.
   */
  digerDurum: number;
}

function yuzde(pay: number, payda: number): number {
  if (payda <= 0) return 0;
  return Math.round((pay / payda) * 1000) / 10;
}

/**
 * Kapsam secenekleri. Konumsal parametre yerine adlandirilmis alan: bu uc
 * `top-posts` rotasindan kopyalanirken 4. argumanin `instagramAccountId`
 * oldugu gozden kacti ve panel kampanya secilince huniyi DARALTMADI —
 * tablo 7 satira duserken serit hala tum kampanyalari yaziyordu.
 */
export interface KapiKapsami {
  instagramAccountId?: string;
  automationId?: string;
}

export async function epostaKapisiHunisi(
  workspaceId: string,
  from: Date,
  toExclusive: Date,
  kapsam: KapiKapsami = {}
): Promise<KapiHunisi> {
  const gruplar = await prisma.dmLog.groupBy({
    by: ["automationId", "status"],
    where: {
      workspaceId,
      // Goc muhurleri bu sistemin akisi degil.
      isBackfill: false,
      ...sadeceTur("emailgate"),
      createdAt: { gte: from, lt: toExclusive },
      ...(kapsam.instagramAccountId
        ? { instagramAccountId: kapsam.instagramAccountId }
        : {}),
      ...(kapsam.automationId ? { automationId: kapsam.automationId } : {}),
    },
    _count: { _all: true },
  });

  const kovalar = new Map<string, { verdi: number; acik: number }>();
  let digerDurum = 0;
  for (const g of gruplar) {
    const n = g._count._all;
    if (g.status !== "SENT" && g.status !== "PENDING") {
      digerDurum += n;
      continue;
    }
    const k = kovalar.get(g.automationId) ?? { verdi: 0, acik: 0 };
    if (g.status === "SENT") k.verdi += n;
    else k.acik += n;
    kovalar.set(g.automationId, k);
  }

  // Kampanya adlari: id -> ad. Silinmis kampanya kalirsa id ile gosterilir,
  // satiri tamamen dusurmek sayiyi sessizce eksiltirdi.
  const adlar = new Map<string, string>();
  if (kovalar.size > 0) {
    const kampanyalar = await prisma.automation.findMany({
      where: { id: { in: [...kovalar.keys()] } },
      select: { id: true, name: true },
    });
    for (const a of kampanyalar) adlar.set(a.id, a.name);
  }

  const satirlar: KapiSatiri[] = [...kovalar.entries()]
    .map(([automationId, k]) => ({
      automationId,
      automationName: adlar.get(automationId) ?? automationId,
      soruldu: k.verdi + k.acik,
      verdi: k.verdi,
      acik: k.acik,
      oran: yuzde(k.verdi, k.verdi + k.acik),
    }))
    .sort((a, b) => b.soruldu - a.soruldu);

  const soruldu = satirlar.reduce((t, s) => t + s.soruldu, 0);
  const verdi = satirlar.reduce((t, s) => t + s.verdi, 0);

  return {
    satirlar,
    toplam: { soruldu, verdi, acik: soruldu - verdi, oran: yuzde(verdi, soruldu) },
    digerDurum,
  };
}
