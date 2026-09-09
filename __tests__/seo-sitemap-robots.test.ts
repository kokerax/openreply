/**
 * sitemap.xml ve robots.txt testleri.
 *
 * Kritik olan iki yon: indekslenmesi GEREKEN sayfa listede OLMALI, ve
 * indekslenmemesi gereken (gizli rapor baglantisi, panel, API) listede
 * OLMAMALI. Tek yonlu "liste bos degil" asserti hicbir sey kanitlamaz.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ESKI_URL = process.env.NEXTAUTH_URL;

beforeEach(() => {
  vi.resetModules();
  process.env.NEXTAUTH_URL = "https://openreply.dijitalpilot.com";
});

afterEach(() => {
  if (ESKI_URL === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = ESKI_URL;
});

async function sitemapGetir() {
  const mod = await import("@/app/sitemap");
  return mod.default();
}

async function robotsGetir() {
  const mod = await import("@/app/robots");
  return mod.default();
}

describe("sitemap", () => {
  it("oksuz kalan dort pazarlama sayfasinin hepsini icerir", async () => {
    const yollar = (await sitemapGetir()).map((e) => new URL(e.url).pathname);

    for (const yol of [
      "/manychat-alternative",
      "/comment-link-automation",
      "/instagram-dm-automation-agencies",
      "/instagram-comment-to-dm-templates",
      "/templates",
    ]) {
      expect(yollar).toContain(yol);
    }
  });

  it("sekiz sablon sayfasinin hepsini icerir", async () => {
    const { CAMPAIGN_TEMPLATES } = await import("@/lib/templates/campaign-templates");
    const yollar = (await sitemapGetir()).map((e) => new URL(e.url).pathname);

    expect(CAMPAIGN_TEMPLATES.length).toBeGreaterThan(0);
    for (const t of CAMPAIGN_TEMPLATES) {
      expect(yollar).toContain(`/templates/${t.slug}`);
    }
  });

  it("gizli ve kisiye ozel rotalari DISARIDA birakir", async () => {
    const yollar = (await sitemapGetir()).map((e) => new URL(e.url).pathname);

    // Paylasilan rapor baglantisi gizli slug ile korunuyor; sitemap'e koymak
    // onu aramaya acardi.
    for (const yasak of ["/login", "/verify-request"]) {
      expect(yollar).not.toContain(yasak);
    }
    expect(yollar.some((y) => y.startsWith("/reports"))).toBe(false);
    expect(yollar.some((y) => y.startsWith("/invite"))).toBe(false);
    expect(yollar.some((y) => y.startsWith("/api"))).toBe(false);
  });

  it("mutlak URL uretir ve tabani ortamdan alir", async () => {
    const girdiler = await sitemapGetir();

    expect(girdiler.length).toBeGreaterThan(0);
    for (const e of girdiler) {
      // Kok girdide sondaki slash yok, digerlerinde var — ikisi de gecerli.
      expect(e.url).toMatch(/^https:\/\/openreply\.dijitalpilot\.com(\/|$)/);
      // Cift slash olusmamali (taban sondaki slash ile gelse bile).
      expect(e.url.replace("https://", "")).not.toContain("//");
    }
  });

  it("ana sayfaya en yuksek onceligi verir", async () => {
    const girdiler = await sitemapGetir();
    const ana = girdiler.find((e) => new URL(e.url).pathname === "/");

    expect(ana?.priority).toBe(1);
    for (const e of girdiler) {
      expect(e.priority ?? 0).toBeLessThanOrEqual(ana?.priority ?? 0);
    }
  });
});

describe("SEO sayfalari birbirine link verir", () => {
  it("kayittaki her sayfa sitemap'te de var", () => {
    // Ic link kaydi ile sitemap ayrisirsa, link verilen sayfa taranmayabilir.
    const src = fs.readFileSync(
      path.join(process.cwd(), "components/seo-page-shell.tsx"),
      "utf8"
    );
    const i = src.indexOf("export const SEO_SAYFALARI");
    expect(i).toBeGreaterThan(-1);
    const blok = src.slice(i, src.indexOf("];", i));
    const yollar = [...blok.matchAll(/path: "([^"]+)"/g)].map((m) => m[1]);

    expect(yollar.length).toBeGreaterThanOrEqual(5);
    return sitemapGetir().then((girdiler) => {
      const sitemapYollari = girdiler.map((e) => new URL(e.url).pathname);
      for (const y of yollar) expect(sitemapYollari).toContain(y);
    });
  });

  it("kabuk kendi sayfasini ILGILI listesinden cikarir", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "components/seo-page-shell.tsx"),
      "utf8"
    );
    // Kendine link vermek hem gereksiz hem de kullaniciyi ayni sayfaya atar.
    expect(src).toMatch(/SEO_SAYFALARI\.filter\(\(s\) => s\.path !== config\.path\)/);
  });
});

describe("robots", () => {
  it("sitemap adresini bildirir", async () => {
    const r = await robotsGetir();
    expect(r.sitemap).toBe("https://openreply.dijitalpilot.com/sitemap.xml");
  });

  it("panel, API ve gizli rapor yollarini kapatir", async () => {
    const r = await robotsGetir();
    const kural = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    const kapali = (kural.disallow ?? []) as string[];

    for (const yol of ["/api/", "/reports/", "/settings", "/leads", "/r/"]) {
      expect(kapali).toContain(yol);
    }
  });

  it("pazarlama sayfalarini KAPATMAZ", async () => {
    const r = await robotsGetir();
    const kural = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    const kapali = (kural.disallow ?? []) as string[];

    // Karsi yon: kapatma listesi asiri genis olursa SEO sayfalari da duser.
    expect(kural.allow).toBe("/");
    for (const yol of ["/manychat-alternative", "/templates", "/"]) {
      expect(kapali).not.toContain(yol);
    }
  });
});
