/**
 * Kisa link hedefine UTM etiketleri ekler.
 *
 * Neden: `/r/<slug>` tiklamasi kullanicinin kendi sitesine gidiyor ama hicbir
 * atif tasimiyordu — GA4'te bu trafik "direct/referral" olarak gorunuyor ve
 * "Instagram otomasyonu siteme ne getirdi" sorusu cevapsiz kaliyordu.
 * Tiklama sayisini biz zaten tutuyoruz; eksik olan, kullanicinin KENDI
 * analitiginde ayni trafigi taniyabilmesi.
 */

export interface UtmGirdi {
  /** Kampanya adi; `utm_campaign` icin sadelestirilir. */
  kampanyaAdi: string | null | undefined;
  /** Izlenen linkin slug'i; `utm_content` olarak gider (link bazinda ayrim). */
  slug: string | null | undefined;
}

/**
 * Turkce harfleri ASCII'ye indirger ve URL'e uygun hale getirir.
 *
 * Asagidaki NFD ayristirmasi ş/ğ/ü/ö/ç/İ'yi ZATEN cozuyor (birlesik isaret
 * ayrilip atiliyor). Olculdu: "aşa" -> "asa", "aİa" -> "aia".
 *
 * Tek istisna **ı** (noktasiz i, U+0131): birlesik isaret tasimadigi icin
 * ayrisMIYOR, ASCII de olmadigi icin tireye donuyordu — "Iğdır" -> "igd-r".
 * O yuzden yalnizca bu harf acikca cevriliyor. (Once ş/ğ/ü/ö/ç icin de acik
 * kurallar yazmistim; mutasyon testi onlari kaldirinca YESIL kaldi, yani
 * hicbir sey yapmiyorlardi — silindiler.)
 */
export function utmSadelestir(metin: string | null | undefined): string {
  // Cagiran taraf eksik alan gecerse etiket kaybolsun, YONLENDIRME KIRILMASIN.
  return String(metin ?? "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Hedef URL'e UTM ekler.
 *
 * Uc kural:
 * 1. **Var olan parametre EZILMEZ.** Kullanici hedefe kendi `utm_source`'unu
 *    yazdiysa onun tercihi kazanir.
 * 2. **Fragment korunur ve SONDA kalir.** `.../promptlar/#gta` hedefinde
 *    sorgu, `#` isaretinden ONCE gelmeli; sonuna eklemek link'i bozar ve
 *    tarayici parametreyi fragment'in parcasi sanar. Gercek kampanya
 *    hedeflerimiz tam olarak bu sekilde (`#gta`, `#papercut-sehir-posteri`).
 * 3. **Cozulemeyen URL'e DOKUNULMAZ.** Derin baglanti / uygulama semasi gibi
 *    bir sey gelirse oldugu gibi dondurulur; bozmaktansa etiketsiz birakmak
 *    iyidir.
 */
export function hedefeUtmEkle(hedefUrl: string, girdi: UtmGirdi): string {
  let url: URL;
  try {
    url = new URL(hedefUrl);
  } catch {
    return hedefUrl;
  }

  // Yalnizca web adresleri. `mailto:`, `tel:`, uygulama semalarinda UTM
  // anlamsizdir ve bazilarinda sorgu eklemek adresi gecersiz kilar.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return hedefUrl;
  }

  const etiketler: Record<string, string> = {
    utm_source: "instagram",
    utm_medium: "openreply",
    utm_campaign: utmSadelestir(girdi.kampanyaAdi) || "kampanya",
    utm_content: String(girdi.slug ?? ""),
  };

  for (const [anahtar, deger] of Object.entries(etiketler)) {
    if (!deger) continue;
    if (url.searchParams.has(anahtar)) continue; // kullanicinin tercihi kazanir
    url.searchParams.set(anahtar, deger);
  }

  // URL nesnesi fragment'i zaten sorgudan SONRA yaziyor; burada acikca
  // dogruluyoruz ki bir gun siralamayi elle kurmaya kalkan biri bozmasin.
  return url.toString();
}
