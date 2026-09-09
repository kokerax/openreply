/**
 * SEO saglik denetimi.
 *
 * 2026-09-09'da bes SEO kusuru duzeltildi (sitemap ve robots HIC yoktu,
 * `metadataBase` tanimsizdi ve `og:url` GORELI basiliyordu, sablon sayfalari
 * canonical'sizdi, FAQ isaretlemesi yoktu, oksuz sayfalara ic link yoktu).
 * Bunlarin hepsi **sessizce** geri gelebilir: bir refactor `metadataBase`'i
 * dusurse ya da biri `sitemap.ts`'i silse hicbir test kirmizi yanmaz ve
 * kimse aylarca fark etmez.
 *
 * Bu modul CANLI SAYFALARI cekip bakiyor — kaynak kodu degil. Kaynakta dogru
 * gorunup uretimde cikmayan seyler (metadataBase'in gercekten mutlak URL
 * uretmesi gibi) ancak boyle yakalanir.
 */
import { getBaseUrl } from "@/lib/env";

export type SeoDurum = "gecti" | "kaldi" | "belirsiz";

export interface SeoKontrol {
  ad: string;
  durum: SeoDurum;
  detay: string;
}

export interface SeoSaglik {
  kontroller: SeoKontrol[];
  /**
   * Kac birim islendi. Bir koruma aracinin "sessizce hicbir sey bulamamasi"
   * ile "temiz" demesi ayni ciktiya benzememeli.
   */
  taranan: { sayfa: number; sitemapUrl: number };
  gecti: number;
  kaldi: number;
  belirsiz: number;
}

/** Ornek olarak cekilen SEO sayfasi; canonical/og/JSON-LD burada aranir. */
const ORNEK_SAYFA = "/manychat-alternative";

async function metin(url: string): Promise<{ ok: boolean; govde: string; durum: number }> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    return { ok: r.ok, govde: r.ok ? await r.text() : "", durum: r.status };
  } catch {
    return { ok: false, govde: "", durum: 0 };
  }
}

/**
 * og:image ETIKETI var demek YETMEZ: adres 404/500 dondurse de etiket
 * yerinde durur ve paylasim yine gorselsiz cikar. Bu yuzden adres cekilip
 * gercekten bir gorsel geldigi dogrulaniyor.
 */
async function gorsel(
  url: string
): Promise<{ ok: boolean; durum: number; tur: string }> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    return { ok: r.ok, durum: r.status, tur: r.headers.get("content-type") ?? "" };
  } catch {
    return { ok: false, durum: 0, tur: "" };
  }
}

export async function seoSagligiOl(): Promise<SeoSaglik> {
  const taban = getBaseUrl().replace(/\/$/, "");
  const kontroller: SeoKontrol[] = [];
  let sitemapUrl = 0;
  let sayfa = 0;

  const [sitemap, robots, ornek, anasayfa] = await Promise.all([
    metin(`${taban}/sitemap.xml`),
    metin(`${taban}/robots.txt`),
    metin(`${taban}${ORNEK_SAYFA}`),
    metin(`${taban}/`),
  ]);
  sayfa = [sitemap, robots, ornek, anasayfa].filter((r) => r.ok).length;

  // 1) sitemap
  if (!sitemap.ok) {
    // `durum: 0` = istek hic tamamlanmadi (DNS/TLS/timeout). Bu "sitemap yok"
    // DEGIL "bakamadim"dir; kesin basarisizlik demek yanlis alarm uretir.
    // Sayfadan turetilen kontroller zaten bu ayrimi yapiyordu; sitemap ve
    // robots yapmiyordu.
    kontroller.push({
      ad: "sitemap.xml",
      durum: sitemap.durum === 0 ? "belirsiz" : "kaldi",
      detay: sitemap.durum === 0 ? "istek tamamlanmadi" : `HTTP ${sitemap.durum}`,
    });
  } else {
    const urller = [...sitemap.govde.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    sitemapUrl = urller.length;
    const goreli = urller.filter((u) => !/^https?:\/\//.test(u)).length;
    const gizli = urller.filter((u) => /\/(reports|invite|api)\//.test(u)).length;
    kontroller.push({
      ad: "sitemap.xml",
      durum: urller.length > 0 && goreli === 0 && gizli === 0 ? "gecti" : "kaldi",
      detay:
        urller.length === 0
          ? "hic URL yok"
          : gizli > 0
            ? `${gizli} gizli rota sizmis`
            : goreli > 0
              ? `${goreli} goreli URL`
              : `${urller.length} URL`,
    });
  }

  // 2) robots
  kontroller.push({
    ad: "robots.txt",
    durum: !robots.ok
      ? robots.durum === 0
        ? "belirsiz"
        : "kaldi"
      : /Sitemap:\s*https?:\/\//i.test(robots.govde)
        ? "gecti"
        : "kaldi",
    detay: !robots.ok
      ? robots.durum === 0
        ? "istek tamamlanmadi"
        : `HTTP ${robots.durum}`
      : /Sitemap:/i.test(robots.govde)
        ? "sitemap satiri var"
        : "sitemap satiri YOK",
  });

  if (!ornek.ok) {
    // Sayfa cekilemediyse ondan turetilen her sey BELIRSIZ — "kaldi" demek
    // yanlis alarm, "gecti" demek sahte guven olurdu.
    for (const ad of ["og:url mutlak", "canonical", "FAQ isaretlemesi", "og:image"]) {
      kontroller.push({ ad, durum: "belirsiz", detay: `ornek sayfa HTTP ${ornek.durum}` });
    }
  } else {
    const og = ornek.govde.match(/property="og:url" content="([^"]*)"/)?.[1];
    kontroller.push({
      ad: "og:url mutlak",
      durum: og && /^https?:\/\//.test(og) ? "gecti" : "kaldi",
      detay: og ? og : "og:url yok (metadataBase dusmus olabilir)",
    });

    const canonical = ornek.govde.match(/rel="canonical" href="([^"]*)"/)?.[1];
    kontroller.push({
      ad: "canonical",
      durum: canonical && /^https?:\/\//.test(canonical) ? "gecti" : "kaldi",
      detay: canonical ?? "canonical yok",
    });

    // Paylasim karti. 2026-09-09 olcumunde sekiz pazarlama sayfasinin
    // HICBIRINDE og:image yoktu; link paylasildiginda gorselsiz cikiyordu.
    const ogGorsel = ornek.govde.match(/property="og:image" content="([^"]*)"/)?.[1];
    if (!ogGorsel) {
      kontroller.push({ ad: "og:image", durum: "kaldi", detay: "og:image etiketi YOK" });
    } else {
      const adres = ogGorsel.startsWith("http") ? ogGorsel : `${taban}${ogGorsel}`;
      const g = await gorsel(adres);
      kontroller.push({
        ad: "og:image",
        // Tasima hatasi "kaldi" DEGIL: gecici bir kesintide yanlis alarm olur.
        durum: g.durum === 0
          ? "belirsiz"
          : g.ok && g.tur.startsWith("image/")
            ? "gecti"
            : "kaldi",
        detay: g.durum === 0
          ? "gorsel istegi tamamlanmadi"
          : g.ok
            ? g.tur.startsWith("image/")
              ? g.tur
              : `gorsel degil: ${g.tur || "tur yok"}`
            : `HTTP ${g.durum}`,
      });
    }

    const soru = (ornek.govde.match(/"@type":"Question"/g) ?? []).length;
    kontroller.push({
      ad: "FAQ isaretlemesi",
      durum: ornek.govde.includes('"@type":"FAQPage"') && soru > 0 ? "gecti" : "kaldi",
      detay: soru > 0 ? `${soru} soru` : "FAQPage JSON-LD yok",
    });
  }

  // 3b) SEO sayfalari BIRBIRINE link veriyor mu.
  // Olculdu: her sayfa digerlerinin yalnizca 1-2'sine link veriyordu ve uc
  // sayfa hicbir SEO sayfasindan link ALMIYORDU. Ornek sayfada bakmak yeter:
  // blok paylasilan kabuktan geliyor, dusserse hepsinde duser.
  if (ornek.ok) {
    const digerleri = [
      "/comment-link-automation",
      "/instagram-dm-automation-agencies",
      "/instagram-comment-to-dm-templates",
      "/templates",
    ];
    const eksik = digerleri.filter((h) => !ornek.govde.includes(`href="${h}"`));
    kontroller.push({
      ad: "sayfalar arasi link",
      durum: eksik.length === 0 ? "gecti" : "kaldi",
      detay:
        eksik.length === 0
          ? `${digerleri.length} kardes sayfa linkli`
          : `link yok: ${eksik.join(", ")}`,
    });
  } else {
    kontroller.push({
      ad: "sayfalar arasi link",
      durum: "belirsiz",
      detay: `ornek sayfa HTTP ${ornek.durum}`,
    });
  }

  // 3) Ic link: oksuz sayfalar ana sayfadan link almali, yoksa kesfedilemez.
  if (!anasayfa.ok) {
    kontroller.push({ ad: "ic link", durum: "belirsiz", detay: `ana sayfa HTTP ${anasayfa.durum}` });
  } else {
    const hedefler = [
      "/manychat-alternative",
      "/comment-link-automation",
      "/instagram-dm-automation-agencies",
      "/templates",
    ];
    const eksik = hedefler.filter((h) => !anasayfa.govde.includes(`href="${h}"`));
    kontroller.push({
      ad: "ic link",
      durum: eksik.length === 0 ? "gecti" : "kaldi",
      detay: eksik.length === 0 ? `${hedefler.length} sayfa linkli` : `link yok: ${eksik.join(", ")}`,
    });
  }

  return {
    kontroller,
    taranan: { sayfa, sitemapUrl },
    gecti: kontroller.filter((k) => k.durum === "gecti").length,
    kaldi: kontroller.filter((k) => k.durum === "kaldi").length,
    belirsiz: kontroller.filter((k) => k.durum === "belirsiz").length,
  };
}
