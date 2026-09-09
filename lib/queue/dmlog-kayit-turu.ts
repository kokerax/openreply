/**
 * DmLog kayit turleri — tek dogruluk kaynagi.
 *
 * DmLog yalnizca yorumlari tutmuyor. E-posta kapisi, takip kapisi, link
 * acilisi ve DM tetikleyicisi de ayni tabloya defter satiri yaziyor ve
 * `commentId` alanina "emailgate:<igsid>" gibi SENTETIK bir anahtar koyuyor.
 * Gercek Instagram yorum kimlikleri tamamen rakamdir.
 *
 * ## Neden bu modul var
 *
 * Bu ayrim `commentId`'deki iki nokta karakterine dayaniyordu ve HICBIR YERDE
 * yazili degildi. Sonuc: 2026-09-09 oturumunda ayni hata UC KEZ yapildi —
 * yorum sayan sorgular defter satirlarini da sayip yanlis evreni olctu:
 *
 *   1. Yorum cevabi kurtarmasi her saat 15 sentetik satiri kuyrukluyordu;
 *      worker sessizce atliyordu, is hatasiz "DONE" oluyordu. "205 kisi
 *      bekliyor" diye rapor edildi — gercek bekleyen SIFIRDI.
 *   2. Ayni modulun aday sorgusu duzeltilirken tekrar gozden kacti.
 *   3. Panelin "Where the comments came from" karti "izlenmeyen 306"
 *      gosteriyordu; 247'si yorum bile degildi (%81 yanlis kovada).
 *
 * Ucuncu tekrardan sonra not degil MEKANIZMA yazildi. Kural: sentetik anahtar
 * yalnizca `sentetikAnahtar()` ile uretilir, yorum sayan sorgular
 * `SADECE_YORUM` kullanir. `__tests__/dmlog-kayit-turu.test.ts` satir ici
 * anahtar uretimini yasakliyor; teslimat denetimi de bilinmeyen bir onek
 * ortaya cikarsa alarm veriyor.
 */

/** Yorum OLMAYAN kayitlarin onekleri. Yeni tur eklenirse BURAYA eklenir. */
export const SENTETIK_TURLER = {
  /** E-posta kapisi: adres istendi / bekleniyor. */
  emailgate: "emailgate",
  /** Link acildi (buton dokunusu ya da e-posta sonrasi teslim). */
  reveal: "reveal",
  /** Takip istemi gonderildi. */
  followgate: "followgate",
  /** Takip istemi gonderildi. */

  /** DM tetikleyici (yorumdan degil, dogrudan mesajdan). */
  dm: "dm",
} as const;

export type SentetikTur = keyof typeof SENTETIK_TURLER;

/**
 * Sentetik `commentId` uretmenin TEK yolu.
 *
 * Satir ici `` `reveal:${id}` `` yazmak yasak: o zaman yeni bir tur eklendiginde
 * bu modul haberdar olmaz ve yorum sayan sorgular onu sessizce yorum sanar.
 */
export function sentetikAnahtar(tur: SentetikTur, id: string): string {
  return `${SENTETIK_TURLER[tur]}:${id}`;
}

/** `commentId` bir defter satirina mi ait (yani gercek bir yorum DEGIL mi). */
export function sentetikMi(commentId: string | null | undefined): boolean {
  return typeof commentId === "string" && commentId.includes(":");
}

/**
 * Onek biliniyor mu. Bilinmeyen bir onek, birinin bu modulden gecmeden yeni
 * bir tur eklediginin isareti — teslimat denetimi bunu alarma cevirir.
 */
export function bilinenSentetikTur(commentId: string): boolean {
  if (!sentetikMi(commentId)) return false;
  const onek = commentId.slice(0, commentId.indexOf(":"));
  return Object.values(SENTETIK_TURLER).includes(
    onek as (typeof SENTETIK_TURLER)[SentetikTur]
  );
}

/**
 * Prisma `where` parcasi: SADECE gercek yorumlar.
 *
 * "Kac yorum geldi", "yorumlar nereden geldi", "hangi yoruma cevap yazilmadi"
 * gibi her sorgu bunu kullanmali. Tum gonderimleri sayan sorgular (gunluk
 * grafik, kota) KULLANMAZ — orada defter satirlari da gercek mesajdir.
 */
export const SADECE_YORUM = { commentId: { not: { contains: ":" } } } as const;

// ─── Buton postback yukleri — AYRI AD ALANI ─────────────────────────────────
//
// Acilis DM'indeki butona basilinca Meta bize bir "payload" geri gonderir ve
// o da `<onek>:<id>` bicimindedir. `commentId` ile AYNI GORUNUR ama ayni sey
// DEGILDIR: burada `<id>` kampanya kimligi, orada kisi kimligi.
//
// `reveal` ikisinde de geciyor; ayni fonksiyondan uretmek bu iki ad alanini
// birbirine karistirir. Bu yuzden ayri tutuluyorlar.

export const POSTBACK_TURLERI = {
  /** Takip kontrolu istendi: kisi "takip ediyorum" butonuna basacak. */
  followcheck: "followcheck",
  /** Linki dogrudan ac (takip zorunlu degilse). */
  reveal: "reveal",
} as const;

export type PostbackTuru = keyof typeof POSTBACK_TURLERI;

/** Buton payload'i uretmenin tek yolu. */
export function postbackYuku(tur: PostbackTuru, automationId: string): string {
  return `${POSTBACK_TURLERI[tur]}:${automationId}`;
}

/** Gelen payload hangi tur — taninmiyorsa null. */
export function postbackTuru(payload: string): PostbackTuru | null {
  for (const tur of Object.keys(POSTBACK_TURLERI) as PostbackTuru[]) {
    if (payload.startsWith(`${POSTBACK_TURLERI[tur]}:`)) return tur;
  }
  return null;
}
