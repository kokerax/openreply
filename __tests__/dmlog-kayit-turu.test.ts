/**
 * DmLog kayit turu mekanizmasi.
 *
 * Ayni hata bu oturumda UC KEZ yapildi: yorum sayan sorgular defter
 * satirlarini da sayip yanlis evreni olctu. Not yazmak yetmedi (ilk iki
 * seferden sonra yorum eklenmisti), bu yuzden mekanizma yazildi. Bu testler
 * mekanizmanin ATLANMASINI engelliyor.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  POSTBACK_TURLERI,
  SADECE_YORUM,
  SENTETIK_TURLER,
  bilinenSentetikTur,
  postbackTuru,
  postbackYuku,
  sentetikAnahtar,
  sentetikMi,
} from "@/lib/queue/dmlog-kayit-turu";

const oku = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
/** Yorumlari ayikla: dosyanin kendi aciklamasi kod sanilmasin. */
const kodu = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("tur ayrimi", () => {
  it("gercek yorum kimligini SENTETIK saymaz", () => {
    // Gercek Instagram yorum kimlikleri tamamen rakamdir.
    for (const gercek of ["18135964564545570", "17903882799555909", "1"]) {
      expect(sentetikMi(gercek)).toBe(false);
    }
  });

  it("defter satirlarini sentetik sayar", () => {
    for (const tur of Object.keys(SENTETIK_TURLER) as (keyof typeof SENTETIK_TURLER)[]) {
      expect(sentetikMi(sentetikAnahtar(tur, "123"))).toBe(true);
      expect(bilinenSentetikTur(sentetikAnahtar(tur, "123"))).toBe(true);
    }
  });

  it("bilinen turler TAM listelenmis (birini dusurmek sessizce yanlis alarm uretir)", () => {
    // Listeden bir tur dusurulurse nobetci gercek satirlari "bilinmeyen"
    // sayip yanlis alarm verir. Bu yuzden kume ACIKCA sabitleniyor.
    expect(Object.keys(SENTETIK_TURLER).sort()).toEqual(
      ["dm", "emailgate", "followgate", "reveal"].sort()
    );
    expect(Object.keys(POSTBACK_TURLERI).sort()).toEqual(
      ["followcheck", "reveal"].sort()
    );
    // Canli veride gorulen her onek listede olmali (2026-09-09 olcumu:
    // reveal 176, emailgate 68, dm 3, followgate 6).
    for (const onek of ["reveal", "emailgate", "dm", "followgate"]) {
      expect(bilinenSentetikTur(`${onek}:x`)).toBe(true);
    }
  });

  it("BILINMEYEN onek 'bilinen' sayilmaz — mekanizmanin atlandigi an", () => {
    expect(sentetikMi("yenitur:123")).toBe(true);
    expect(bilinenSentetikTur("yenitur:123")).toBe(false);
    // Gercek yorum da "bilinen sentetik" degildir.
    expect(bilinenSentetikTur("18135964564545570")).toBe(false);
  });

  it("bos/null girdide cokmez", () => {
    expect(sentetikMi(null)).toBe(false);
    expect(sentetikMi(undefined)).toBe(false);
    expect(sentetikMi("")).toBe(false);
  });

  it("SADECE_YORUM prisma parcasi sentetikleri eler", () => {
    expect(SADECE_YORUM).toEqual({ commentId: { not: { contains: ":" } } });
  });
});

describe("mekanizma atlanamaz", () => {
  it("worker satir ici anahtar/payload URETMEZ", () => {
    // Satir ici `reveal:${x}` yazilirsa yeni tur bu modulden gecmez ve yorum
    // sayan sorgular onu yorum sanar. Ilk kosuda bu test 5 kacak yakaladi
    // (followcheck) ve iki ad alaninin karistigini ortaya cikardi.
    const src = kodu(oku("lib/queue/dm-worker.ts"));
    expect(src.match(/`[a-z]+:\$\{/g) ?? []).toEqual([]);
    expect(src).toContain("sentetikAnahtar(");
    expect(src).toContain("postbackYuku(");
  });

  it("iki AD ALANI ayri: commentId ile postback payload karismaz", () => {
    // `reveal` ikisinde de geciyor ama <id> farkli: commentId'de KISI,
    // payload'da KAMPANYA kimligi. Ayni fonksiyondan uretmek ikisini
    // birbirine karistirirdi.
    expect(sentetikAnahtar("reveal", "kisi_1")).toBe("reveal:kisi_1");
    expect(postbackYuku("reveal", "kampanya_1")).toBe("reveal:kampanya_1");
    // followcheck YALNIZCA payload tarafinda var — commentId turu degil.
    expect(Object.keys(SENTETIK_TURLER)).not.toContain("followcheck");
    expect(Object.keys(POSTBACK_TURLERI)).toContain("followcheck");
  });

  it("postback ayristirmasi tanidigini tanir, tanimadigina null der", () => {
    expect(postbackTuru("followcheck:a1")).toBe("followcheck");
    expect(postbackTuru("reveal:a1")).toBe("reveal");
    expect(postbackTuru("bilinmeyen:a1")).toBeNull();
    expect(postbackTuru("duz-metin")).toBeNull();
  });

  it("yorum sayan sorgular merkezi parcayi kullanir", () => {
    const yerler: [string, string][] = [
      ["lib/ops/yorum-cevabi-kurtarma.ts", "SADECE_YORUM"],
      ["app/api/dashboard/stats/route.ts", "sentetikMi("],
      ["app/api/automations/[id]/analytics/route.ts", "SADECE_YORUM"],
    ];
    for (const [dosya, beklenen] of yerler) {
      const src = kodu(oku(dosya));
      expect(`${dosya}: ${src.includes(beklenen)}`).toBe(`${dosya}: true`);
      // Elle yazilmis kopya kalmamali.
      expect(`${dosya} elle-kopya`).toBe(
        src.includes('includes(":")') ? `${dosya} elle-kopya VAR` : `${dosya} elle-kopya`
      );
    }
  });

  it("kampanya hunisinin HER ADIMI ayni evrenden sayilir", () => {
    // Huni "yorum -> DM -> tiklama" anlatiyor. `sentSources` sentetikleri
    // eliyordu ama `comments` ve `sentAt` elemiyordu: e-posta kapili bir
    // kampanyada kisi basina 2-3 defter satiri var, payda sisip CTR 2-3 kat
    // dusuk gorunuyordu.
    //
    // Isim aramak yetmez (SADECE_YORUM sabit tanimda da geciyor) — ATAMA
    // aranıyor.
    const src = kodu(oku("app/api/automations/[id]/analytics/route.ts"));
    expect(src).toMatch(/const yorumKapsami = \{[^}]*\.\.\.SADECE_YORUM/);
    // Yorum sayimi ve SENT sorgusu DAR kapsami kullanmali.
    expect(src).toMatch(/dmLog\.count\(\{\s*where:\s*yorumKapsami\s*\}\)/);
    expect(src).toMatch(/where:\s*\{\s*\.\.\.yorumKapsami,\s*status:\s*"SENT"/);
  });

  it("nobetci BILINMEYEN onegi alarma cevirir", () => {
    const src = kodu(oku("app/api/cron/teslimat-denetimi/route.ts"));
    expect(src).toContain("bilinenSentetikTur");
    expect(src).toMatch(/bilinmeyenOnekler\.length > 0/);
    // Yalnizca hesaplayip susmamali — uyariya YAZMALI.
    expect(src).toMatch(/uyarilar\.push\([^)]*BILINMEYEN/);
  });
});
