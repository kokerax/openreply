/**
 * Donem esleme — karsilastirilan iki grup ayni donemlerden gelmeli.
 *
 * Canli veri (2026-09): "cagri yok" grubunun 17 icerigin 15'i 2025'ten,
 * "cagri var" 2024-2026'ya yayilmis. Hesabin medyan izlenmesi 2025'te
 * 28-40K, 2026'da 5-7K. Panel farki cagriya bagliyordu, oysa donem farki.
 */
import { describe, it, expect } from "vitest";
import { cagriVarMi, ctaSecimi, ortakDonemler } from "@/lib/reports/trend-helpers";

const p = (half: string, n: number) => Array.from({ length: n }, () => ({ half }));

describe("ortakDonemler", () => {
  it("her iki grupta da esigi gecen donemleri dondurur", () => {
    const a = [...p("2025 H1", 10), ...p("2026 H1", 8)];
    const b = [...p("2025 H1", 5), ...p("2026 H1", 4)];
    expect(ortakDonemler(a, b, 3)).toEqual(["2025 H1", "2026 H1"]);
  });

  it("BIR grupta esik altinda kalan donemi ELER", () => {
    // Asil vaka: "cagri yok" 2026'da yalnizca 1 icerik tasiyor.
    const a = [...p("2025 H2", 10), ...p("2026 H1", 61)];
    const b = [...p("2025 H2", 15), ...p("2026 H1", 1)];
    expect(ortakDonemler(a, b, 3)).toEqual(["2025 H2"]);
  });

  it("hic ortak donem yoksa BOS dondurur — 'olculemedi' sinyali", () => {
    const a = p("2024 H2", 20);
    const b = p("2026 H1", 20);
    expect(ortakDonemler(a, b, 3)).toEqual([]);
  });

  it("bos gruplarda cokmez", () => {
    expect(ortakDonemler([], [], 3)).toEqual([]);
    expect(ortakDonemler(p("2025 H1", 5), [], 1)).toEqual([]);
  });

  it("esik 1 iken bile TEK TARAFLI donem gecmez", () => {
    // Karsi yon: gevsek esikte de eslesme sarti korunmali.
    const a = [...p("2025 H1", 1), ...p("2026 H1", 1)];
    const b = p("2025 H1", 1);
    expect(ortakDonemler(a, b, 1)).toEqual(["2025 H1"]);
  });

  it("sonuc SIRALI doner", () => {
    const a = [...p("2026 H1", 5), ...p("2024 H2", 5), ...p("2025 H1", 5)];
    const b = [...p("2026 H1", 5), ...p("2024 H2", 5), ...p("2025 H1", 5)];
    expect(ortakDonemler(a, b, 3)).toEqual(["2024 H2", "2025 H1", "2026 H1"]);
  });
});


describe("ctaSecimi — karar saf fonksiyonda", () => {
  // `hasCta` artik disaridan GELMIYOR; ctaSecimi caption'dan kendisi karar
  // veriyor, o yuzden fixture gercek metin tasiyor.
  const ic = (half: string, hasCta: boolean, n: number) =>
    Array.from({ length: n }, () => ({
      half,
      caption: hasCta ? "takip et ve yorumlara yaz" : "sadece bir aciklama",
    }));

  it("ortak donem yoksa HIC karsilastirma yapmaz", () => {
    // Canli vaka: cagrisiz icerikler 2025'te, cagrililar her donemde.
    const s = ctaSecimi([...ic("2024 H2", true, 49), ...ic("2026 H1", true, 61),
                         ...ic("2025 H1", false, 15)], 3);
    expect(s.donemler).toEqual([]);
    expect(s.gruplar).toEqual([]);
  });

  it("ortak donem varsa YALNIZCA o donemin icerikleriyle karsilastirir", () => {
    const s = ctaSecimi([
      ...ic("2025 H1", true, 10), ...ic("2026 H1", true, 40),
      ...ic("2025 H1", false, 8), ...ic("2026 H1", false, 1),
    ], 3);

    expect(s.donemler).toEqual(["2025 H1"]);
    // 2026'daki 40 cagrili icerik KARSILASTIRMAYA GIRMEZ: karsiliginda
    // yalnizca 1 cagrisiz icerik var.
    expect(s.gruplar.map((g) => [g.label, g.secili.length])).toEqual([
      ["Çağrı var", 10],
      ["Çağrı yok", 8],
    ]);
  });

  it("KARSI YON: gruplar ayni donemlere yayilmissa hepsi girer", () => {
    const s = ctaSecimi([
      ...ic("2025 H1", true, 10), ...ic("2026 H1", true, 10),
      ...ic("2025 H1", false, 10), ...ic("2026 H1", false, 10),
    ], 3);
    expect(s.donemler).toEqual(["2025 H1", "2026 H1"]);
    expect(s.gruplar.every((g) => g.secili.length === 20)).toBe(true);
  });
});


describe("cagriVarMi — Turkce yazim tercihine bagli OLMAMALI", () => {
  it("Turkce buyuk I ile yazilan cagri da yakalanir", () => {
    // JS'in /i bayragi İ (U+0130) harfini i'ye KATLAMAZ: dogru Turkce
    // yazimla "TAKİP ET VE" cagri YOK sayiliyordu, ASCII "TAKIP ET VE"
    // ise yakalaniyordu. Ayni cagri iki farkli kovaya dusuyordu.
    expect(cagriVarMi("TAKİP ET VE YORUM YAZ")).toBe(true);
    expect(cagriVarMi("TAKIP ET VE")).toBe(true);
    expect(cagriVarMi("takip et ve")).toBe(true);
  });

  it("yorumlar cagrisi her yazimda yakalanir", () => {
    for (const m of ["yorumlara CITY yaz", "YORUMLARA CITY YAZ", "Yorumlara yaz"]) {
      expect(cagriVarMi(m), m).toBe(true);
    }
  });

  it("KARSI YON: cagri OLMAYAN aciklama yine de false", () => {
    // Normalize asiri genis olsaydi her sey cagri sayilir ve gruplardan
    // biri bosalirdi.
    for (const m of [
      "Masaüstün hiç bu kadar havalı olmamıştı! #YapayZeka #Tasarım",
      "Arka plan silmek hiç bu kadar kolay olmamıştı!",
      "",
    ]) {
      expect(cagriVarMi(m), m).toBe(false);
    }
  });

  it("null/undefined guvenli", () => {
    expect(cagriVarMi(null)).toBe(false);
    expect(cagriVarMi(undefined)).toBe(false);
  });
});


describe("ctaSecimi cagriyi KENDISI belirliyor", () => {
  it("caption'dan ayirir — disaridan hasCta beklemez", () => {
    // Mutasyon kanidi: karar rotadayken `hasCta: false` yazan mutasyon 591
    // testin hicbirini kirmiyordu. Karar artik burada.
    const s = ctaSecimi(
      [
        { half: "2026 H1", caption: "TAKİP ET VE yorumlara yaz" },
        { half: "2026 H1", caption: "yorumlara CITY yaz" },
        { half: "2026 H1", caption: "takip et ve" },
        { half: "2026 H1", caption: "sadece hashtag #ai" },
        { half: "2026 H1", caption: "baska bir aciklama" },
        { half: "2026 H1", caption: null },
      ],
      3
    );

    expect(s.sayilar).toEqual({ cagriVar: 3, cagriYok: 3 });
    expect(s.donemler).toEqual(["2026 H1"]);
    expect(s.gruplar.map((g) => [g.label, g.secili.length])).toEqual([
      ["Çağrı var", 3],
      ["Çağrı yok", 3],
    ]);
  });

  it("ortak donem yokken bile SAYILAR raporlanir", () => {
    // "olculemedi" notu bu sayilari yaziyor; bos donmeleri notu bozardi.
    const s = ctaSecimi(
      [
        { half: "2024 H2", caption: "takip et ve" },
        { half: "2025 H1", caption: "duz aciklama" },
      ],
      3
    );
    expect(s.donemler).toEqual([]);
    expect(s.sayilar).toEqual({ cagriVar: 1, cagriYok: 1 });
  });
});
