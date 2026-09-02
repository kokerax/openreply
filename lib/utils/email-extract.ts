/**
 * Serbest metinden e-posta adresi cikarir (DM'e "adresim: ali@x.com, tesekkurler"
 * gibi yazilir; ham metin adres degildir).
 *
 * Kasitli olarak MUHAFAZAKAR: yakalayamadiginda `null` doner ve kullaniciya
 * "gecerli bir adres yaz" denir. Yanlis bir adresi kabul edip linki gondermek,
 * bir kez daha sormaktan pahalidir (liste kirlenir, kisi listeye hic girmez).
 */

/** RFC'nin tamami degil; pratikte gecen adresler + tipik yazim hatalarina kapali. */
const EPOSTA = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

/** Adresin sonuna yapisan noktalama ("ali@x.com." / "ali@x.com,"). */
const SON_NOKTALAMA = /[.,;:!?)\]}'"«»…]+$/;

/** Instagram kullanici adi bahsi (@ile baslar) adres DEGILDIR. */
function bahisMi(metin: string, indeks: number): boolean {
  const oncekiBosluk = metin.lastIndexOf(" ", indeks);
  const kelimeBasi = oncekiBosluk + 1;
  return metin[kelimeBasi] === "@";
}

export function extractEmail(metin: string | null | undefined): string | null {
  if (!metin) return null;
  // Turkce klavyede sik gorulen tam-genislik/benzer karakterleri sadelestir.
  const duz = metin
    .replace(/@|＠/g, "@")
    .replace(/。|．/g, ".")
    .replace(/\s*\(at\)\s*|\s+at\s+/gi, "@")
    .replace(/\s*\(dot\)\s*/gi, ".");

  EPOSTA.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EPOSTA.exec(duz)) !== null) {
    if (bahisMi(duz, m.index)) continue;
    const aday = m[0].replace(SON_NOKTALAMA, "").toLowerCase();
    const [yerel, alan] = aday.split("@");
    if (!yerel || !alan) continue;
    if (yerel.length > 64 || aday.length > 254) continue;
    if (alan.startsWith("-") || alan.endsWith("-")) continue;
    const son = alan.split(".").pop() ?? "";
    if (son.length < 2 || /\d/.test(son)) continue; // "x@y.1" / "x@1.2.3.4" degil
    if (aday.includes("..")) continue;
    return aday;
  }
  return null;
}

/** Metin bir e-posta VERMEYE calisiyor ama bozuk mu? (yalnizca bilgi amacli) */
export function epostaDenemesiMi(metin: string | null | undefined): boolean {
  if (!metin) return false;
  return /@/.test(metin) && extractEmail(metin) === null;
}
