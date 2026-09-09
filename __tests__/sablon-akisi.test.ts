/**
 * SEO sablon sayfasindan kampanya kurucusuna giden akis.
 *
 * Zincir: /templates/<slug> -> /login?template=<slug> -> /campaigns/new?template=<slug>
 * -> CampaignBuilder onddolgusu. Dorduncu adim hic baglanmamisti; secim
 * giristen sonra sessizce dusuyordu.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  CAMPAIGN_TEMPLATES,
  getCampaignTemplate,
} from "@/lib/templates/campaign-templates";

describe("sablon cozumleme", () => {
  it("her sablon slug'i cozulur", () => {
    expect(CAMPAIGN_TEMPLATES.length).toBeGreaterThan(0);
    for (const t of CAMPAIGN_TEMPLATES) {
      expect(getCampaignTemplate(t.slug)?.slug).toBe(t.slug);
    }
  });

  it("KARSI YON: bilinmeyen ya da bos slug null doner, hata firlatmaz", () => {
    for (const kotu of ["yok-boyle-bir-sey", "", null, undefined]) {
      expect(getCampaignTemplate(kotu)).toBeFalsy();
    }
  });

  it("onddolgu icin gereken alanlarin hepsi dolu", () => {
    // Builder bu dort alani onden dolduruyor; biri bos kalirsa kullanici
    // sablonla geldigi halde bos bir form gorur.
    for (const t of CAMPAIGN_TEMPLATES) {
      expect(t.title.trim().length).toBeGreaterThan(0);
      expect(t.goal.trim().length).toBeGreaterThan(0);
      expect(t.keywords.length).toBeGreaterThan(0);
      expect(t.dmMessage.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("sablon akisinin kablolamasi", () => {
  const oku = (p: string) =>
    fs.readFileSync(path.join(process.cwd(), p), "utf8");

  it("campaigns/new sablonu GERCEKTEN cozup builder'a gecirir", async () => {
    // Metin aramak yetmiyor: cozumlemeyi `null` ile degistiren mutasyon
    // 'getCampaignTemplate' import satirinda durdugu icin yesil kaliyordu.
    // Bu yuzden sayfa CAGRILIP donen elemanin prop'una bakiliyor.
    const { default: NewCampaignPage } = await import(
      "@/app/(dashboard)/campaigns/new/page"
    );
    const hedef = CAMPAIGN_TEMPLATES[0];

    const el = await NewCampaignPage({
      searchParams: Promise.resolve({ template: hedef.slug }),
    });

    expect(el.props.mode).toBe("new");
    expect(el.props.template?.slug).toBe(hedef.slug);
    expect(el.props.template?.dmMessage).toBe(hedef.dmMessage);
  });

  it("KARSI YON: bilinmeyen slug'da builder sablonsuz acilir, cokmez", async () => {
    const { default: NewCampaignPage } = await import(
      "@/app/(dashboard)/campaigns/new/page"
    );

    const el = await NewCampaignPage({
      searchParams: Promise.resolve({ template: "boyle-bir-sablon-yok" }),
    });

    expect(el.props.template).toBeUndefined();
    expect(el.props.mode).toBe("new");
  });

  it("login template'i callbackUrl'e tasir", () => {
    const src = oku("app/login/page.tsx");
    expect(src).toContain("/campaigns/new?template=");
  });

  it("builder sablonu YALNIZ yeni kampanyada uygular", () => {
    // edit modunda uygulanirsa kayitli kampanyanin uzerine yazar.
    const src = oku("components/campaign-builder.tsx");
    expect(src).toContain('mode === "new" ? template : undefined');
  });
});

describe("sablon renk tonu", () => {
  it("kullanilan her accent degerinin bir stil karsiligi var", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "components/template-visual.tsx"),
      "utf8"
    );
    const kullanilan = new Set(CAMPAIGN_TEMPLATES.map((t) => t.accent));

    expect(kullanilan.size).toBeGreaterThan(1); // hepsi ayni tonsa ayirt etmiyor
    for (const ton of kullanilan) {
      expect(src).toContain(`${ton}: {`);
    }
  });

  it("sinif adlari TAM YAZILI — kurulmus ad Tailwind ciktisina girmez", () => {
    const ham = fs.readFileSync(
      path.join(process.cwd(), "components/template-visual.tsx"),
      "utf8"
    );
    // Yorumlari AYIKLA: dosyanin kendi aciklamasi bu kalibi ORNEK olarak
    // yaziyor ve tarama onu kod sanip yanlis alarm veriyordu.
    const src = ham.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // `text-` + interpolasyon gibi bir kalip uretimde rengi sessizce yok eder.
    expect(src).not.toMatch(/["'`](?:text|bg|border)-\$\{/);
    expect(src).toContain("text-cyan-200");
    expect(src).toContain("text-emerald-200");
  });
});
