/**
 * Reklam yorumlarinin tarama kapsami.
 *
 * "Her gonderi" (matchAnyPost) kampanyalarinda guvenlik agi yalnizca organik
 * beslemeye bakiyordu: `/me/media` reklam kopyalarini DONDURMEZ, yani Meta'nin
 * ulastiramadigi bir reklam yorumu kalici olarak kayboluyordu. Olcum: son 90
 * gunde 898 yorum webhook'unun 103'u (%11,5) reklam kopyasi.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const oku = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

/** Yorumlari ayikla: aciklama metni kod sanilmasin. */
const kodu = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("matchAnyPost dali reklam kopyalarini kapsar", () => {
  const src = kodu(oku("lib/polling/comment-reconciler.ts"));

  it("matchAnyPost dalinda reklam medyalari da toplanir", () => {
    // Dalin govdesini izole et: postId dalindaki adMediaFor cagrisi bu testi
    // bedava gecirmesin.
    const i = src.indexOf("else if (automation.matchAnyPost)");
    expect(i).toBeGreaterThan(-1);
    const dal = src.slice(i, i + 700);
    expect(dal).toContain("tumReklamMedyalari");
  });

  it("KARSI YON: postId dali kendi kopyalarina bakmaya devam eder", () => {
    const i = src.indexOf("if (automation.postId)");
    const dal = src.slice(i, src.indexOf("else if (automation.matchAnyPost)"));
    expect(dal).toContain("adMediaFor(automation.postId)");
  });

  it("sorgu hesaba gore daraltilir ve tavanlidir", () => {
    const i = src.indexOf("export async function tumReklamMedyalari");
    expect(i).toBeGreaterThan(-1);
    const fn = src.slice(i, i + 1200);
    // Cok hesapli calisma alaninda baska hesabin reklamini taramak bosa cagri.
    expect(fn).toContain("entry->>'id' = ");
    // Her medya ayri bir yorum API cagrisi; tavan olmadan tur sisebilir.
    expect(fn).toContain("REKLAM_MEDYA_TAVANI");
    // Sadece GERCEK kopyalar: original_media_id dolu VE media.id'den farkli.
    expect(fn).toContain("original_media_id");
    expect(fn).toMatch(/<>\s*change->'value'->'media'->>'id'/);
  });

  it("sorgu hatasi taramayi DURDURMAZ", () => {
    const i = src.indexOf("export async function tumReklamMedyalari");
    const fn = src.slice(i, i + 1400);
    // Organik gonderiler yine taranmali; burada firlatmak agi tamamen kapatir.
    expect(fn).toContain("catch");
    expect(fn).toMatch(/return \[\]/);
  });
});

describe("ucusta olan isi tekrar kuyruklama korumasi", () => {
  const src = kodu(oku("lib/polling/comment-reconciler.ts"));

  it("kuyrukta bekleyen/calisan isin yorumu handledSet'e EKLENIR", () => {
    // Isim aramak yetmez: sonuclarin gercekten eleme kumesine katildigini
    // gosteren ATAMA aranıyor.
    expect(src).toMatch(/handledSet\.add\(/);
    expect(src).toMatch(/for\s*\(const\s+\w+\s+of\s+ucustaki\)/);
  });

  it("yalnizca PENDING/ACTIVE isler elenir — biten is elenmez", () => {
    const i = src.indexOf("const ucustaki");
    expect(i).toBeGreaterThan(-1);
    const sorgu = src.slice(i, i + 600);
    expect(sorgu).toContain("'PENDING', 'ACTIVE'");
    // DONE elenirse basarisiz kalmis yorum bir daha ASLA denenmez.
    expect(sorgu).not.toContain("'DONE'");
    expect(sorgu).toContain("process-comment");
  });

  it("koruma, aday listesi SUZULMEDEN once uygulanir", () => {
    // Sonra uygulanirsa hicbir sey elemez.
    const korumaYeri = src.indexOf("handledSet.add(");
    const suzmeYeri = src.indexOf("const fresh = needsAction");
    expect(korumaYeri).toBeGreaterThan(-1);
    expect(suzmeYeri).toBeGreaterThan(korumaYeri);
  });
});

describe("teslimat denetimi reklam korlugu", () => {
  const src = kodu(oku("app/api/cron/teslimat-denetimi/route.ts"));

  it("nobetci reklam medyalarini da tarar", () => {
    expect(src).toContain("tumReklamMedyalari");
    expect(src).toContain("medyaKimlikleri");
  });

  it("yorum cekimi sayfalanir ve tavanlidir", () => {
    // Tek sayfa 50 yorumla siniriydi: yogun gonderide sessizce kesip
    // "kacan yok" diyordu.
    //
    // `toContain("paging?.next")` YETMIYOR: o ifade tip tanimindaki
    // `paging?: { next?: string }` ile de eslesiyor, o yuzden sayfalamayi
    // kaldiran mutasyon yesil kaliyordu. Aranan sey ATAMA.
    expect(src).toMatch(/sonraki\s*=\s*[^;]*b\.paging\?\.next/);
    expect(src).toContain("YORUM_SAYFA_TAVANI");
    // Dongu tavanla sinirli olmali, yoksa tek gonderi turu tuketebilir.
    expect(src).toMatch(/while\s*\([^)]*sayfa\s*<\s*YORUM_SAYFA_TAVANI/);
  });

  it("kac birim tarandigini RAPORLAR", () => {
    // Sessizce hicbir sey bulamamak ile temiz demek ayni ciktiya benzememeli.
    expect(src).toMatch(/taranan:\s*\{/);
    for (const alan of ["medya", "organik", "reklam", "yorum"]) {
      expect(src).toContain(`${alan}:`);
    }
  });
});
