/**
 * SEO saglik denetimi testleri.
 *
 * En kritik ozellik: denetimin BOZUKTA kirmizi, SAGLAMDA sessiz olmasi.
 * Tek yonlu ("saglam veride gecti") bir test, denetimin hicbir seyi
 * kontrol etmedigi durumda da gecerdi.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { seoSagligiOl } from "@/lib/ops/seo-saglik";

const TABAN = "https://ornek.test";
const ESKI = process.env.NEXTAUTH_URL;

const SAGLAM_SITEMAP = `<urlset>
  <url><loc>${TABAN}/</loc></url>
  <url><loc>${TABAN}/manychat-alternative</loc></url>
  <url><loc>${TABAN}/templates/dtc-product-link</loc></url>
</urlset>`;
const SAGLAM_ROBOTS = `User-Agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${TABAN}/sitemap.xml`;
const KARDES_LINKLER = `<a href="/comment-link-automation">a</a><a href="/instagram-dm-automation-agencies">b</a><a href="/instagram-comment-to-dm-templates">c</a><a href="/templates">d</a>`;
const SAGLAM_SAYFA = `<html><head>
  <meta property="og:url" content="${TABAN}/manychat-alternative">
  <link rel="canonical" href="${TABAN}/manychat-alternative">
  <script type="application/ld+json">{"@type":"FAQPage","mainEntity":[{"@type":"Question"},{"@type":"Question"}]}</script>
</head><body>${KARDES_LINKLER}</body></html>`;
const SAGLAM_ANASAYFA = `<a href="/manychat-alternative">a</a><a href="/comment-link-automation">b</a>
  <a href="/instagram-dm-automation-agencies">c</a><a href="/templates">d</a>`;

/** Verilen govdeleri donduren sahte fetch; eksik olan 404 sayilir. */
function fetchKur(govdeler: Partial<Record<string, string>>) {
  vi.stubGlobal("fetch", async (url: string) => {
    const yol = new URL(String(url)).pathname;
    const govde = govdeler[yol];
    if (govde === undefined) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => govde };
  });
}

const SAGLAM = {
  "/sitemap.xml": SAGLAM_SITEMAP,
  "/robots.txt": SAGLAM_ROBOTS,
  "/manychat-alternative": SAGLAM_SAYFA,
  "/": SAGLAM_ANASAYFA,
};

const durum = (s: Awaited<ReturnType<typeof seoSagligiOl>>, ad: string) =>
  s.kontroller.find((k) => k.ad === ad)?.durum;

beforeEach(() => {
  process.env.NEXTAUTH_URL = TABAN;
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (ESKI === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = ESKI;
});

describe("saglam kurulumda SESSIZ", () => {
  it("her kontrol gecer ve taranan birim sayisi raporlanir", async () => {
    fetchKur(SAGLAM);

    const s = await seoSagligiOl();

    expect(s.kaldi).toBe(0);
    expect(s.belirsiz).toBe(0);
    expect(s.gecti).toBe(s.kontroller.length);
    // Bir koruma araci kac birim taradigini HEP yazmali.
    expect(s.taranan.sayfa).toBe(4);
    expect(s.taranan.sitemapUrl).toBe(3);
  });
});

describe("bozukta KIRMIZI — her kusur ayri ayri", () => {
  it("sitemap yoksa yakalar", async () => {
    fetchKur({ ...SAGLAM, "/sitemap.xml": undefined });
    expect(durum(await seoSagligiOl(), "sitemap.xml")).toBe("kaldi");
  });

  it("sitemap'te GORELI URL varsa yakalar", async () => {
    fetchKur({ ...SAGLAM, "/sitemap.xml": "<urlset><url><loc>/goreli</loc></url></urlset>" });
    const s = await seoSagligiOl();
    expect(durum(s, "sitemap.xml")).toBe("kaldi");
    expect(s.kontroller.find((k) => k.ad === "sitemap.xml")?.detay).toContain("goreli");
  });

  it("sitemap'e GIZLI rota sizarsa yakalar", async () => {
    fetchKur({
      ...SAGLAM,
      "/sitemap.xml": `<urlset><url><loc>${TABAN}/reports/gizli-slug</loc></url></urlset>`,
    });
    expect(durum(await seoSagligiOl(), "sitemap.xml")).toBe("kaldi");
  });

  it("robots'ta sitemap satiri yoksa yakalar", async () => {
    fetchKur({ ...SAGLAM, "/robots.txt": "User-Agent: *\nAllow: /" });
    expect(durum(await seoSagligiOl(), "robots.txt")).toBe("kaldi");
  });

  it("og:url GORELI ise yakalar (metadataBase dusmus demektir)", async () => {
    fetchKur({
      ...SAGLAM,
      "/manychat-alternative": SAGLAM_SAYFA.replace(
        `content="${TABAN}/manychat-alternative"`,
        'content="/manychat-alternative"'
      ),
    });
    expect(durum(await seoSagligiOl(), "og:url mutlak")).toBe("kaldi");
  });

  it("canonical yoksa yakalar", async () => {
    fetchKur({
      ...SAGLAM,
      "/manychat-alternative": SAGLAM_SAYFA.replace(/<link rel="canonical"[^>]*>/, ""),
    });
    expect(durum(await seoSagligiOl(), "canonical")).toBe("kaldi");
  });

  it("FAQ isaretlemesi yoksa yakalar", async () => {
    fetchKur({
      ...SAGLAM,
      "/manychat-alternative": SAGLAM_SAYFA.replace(/<script[\s\S]*?<\/script>/, ""),
    });
    expect(durum(await seoSagligiOl(), "FAQ isaretlemesi")).toBe("kaldi");
  });

  it("KARDES sayfa linki dusrse yakalar", async () => {
    // Blok paylasilan kabuktan geliyor: dusserse dort sayfada birden duser.
    fetchKur({
      ...SAGLAM,
      "/manychat-alternative": SAGLAM_SAYFA.replace(
        '<a href="/comment-link-automation">a</a>',
        ""
      ),
    });

    const s = await seoSagligiOl();

    expect(durum(s, "sayfalar arasi link")).toBe("kaldi");
    expect(s.kontroller.find((k) => k.ad === "sayfalar arasi link")?.detay).toContain(
      "/comment-link-automation"
    );
  });

  it("ic link dusrse yakalar ve HANGISININ dustugunu yazar", async () => {
    fetchKur({ ...SAGLAM, "/": '<a href="/templates">d</a>' });
    const s = await seoSagligiOl();
    expect(durum(s, "ic link")).toBe("kaldi");
    expect(s.kontroller.find((k) => k.ad === "ic link")?.detay).toContain(
      "/manychat-alternative"
    );
  });
});

describe("ucuncu durum: BELIRSIZ", () => {
  it("ornek sayfa cekilemezse 'kaldi' DEMEZ, 'belirsiz' der", async () => {
    // Gecici bir 503'e bakip "SEO bozuk" demek yanlis alarm; "gecti" demek
    // sahte guven. Guard goremedigini goremedigi olarak raporlamali.
    fetchKur({ ...SAGLAM, "/manychat-alternative": undefined });

    const s = await seoSagligiOl();

    for (const ad of ["og:url mutlak", "canonical", "FAQ isaretlemesi", "sayfalar arasi link"]) {
      expect(durum(s, ad)).toBe("belirsiz");
    }
    expect(s.belirsiz).toBe(4);
    // Cekilebilen sayfalar hala dogru degerlendirilir.
    expect(durum(s, "sitemap.xml")).toBe("gecti");
  });

  it("TASIMA hatasi 'kaldi' DEGIL 'belirsiz' verir", async () => {
    // DNS/TLS/timeout dalgalanmasinda "sitemap.xml KALDI" yazmak yanlis
    // alarmdir: arac "bakamadim" ile "yok"u ayirmali.
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).endsWith("/sitemap.xml")) throw new Error("ECONNRESET");
      const yol = new URL(String(url)).pathname;
      const govde = (SAGLAM as Record<string, string>)[yol];
      if (govde === undefined) return { ok: false, status: 404, text: async () => "" };
      return { ok: true, status: 200, text: async () => govde };
    });

    const s = await seoSagligiOl();

    expect(durum(s, "sitemap.xml")).toBe("belirsiz");
    // 404 ise (gercekten yok) hala KALDI demeli — iki yon.
    expect(durum(s, "robots.txt")).toBe("gecti");
  });

  it("GERCEKTEN yoksa (404) hala 'kaldi' der", async () => {
    fetchKur({ ...SAGLAM, "/sitemap.xml": undefined });
    expect(durum(await seoSagligiOl(), "sitemap.xml")).toBe("kaldi");
  });

  it("ag tamamen dusukse cokmez", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });

    const s = await seoSagligiOl();

    expect(s.taranan.sayfa).toBe(0);
    expect(s.kontroller.length).toBeGreaterThan(0);
  });
});
