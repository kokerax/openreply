import { describe, it, expect } from "vitest";
import { hedefeUtmEkle, utmSadelestir } from "@/lib/tracking/utm";

const G = { kampanyaAdi: "CITY Şehir Promptu", slug: "city-054b62" };

describe("utmSadelestir", () => {
  it("Turkce harfleri ASCII'ye indirir", () => {
    // toLowerCase() tek basina "ş"yi "s" YAPMAZ; etiket kirik cikardi.
    expect(utmSadelestir("CITY Şehir Promptu")).toBe("city-sehir-promptu");
    expect(utmSadelestir("Araç yazana link")).toBe("arac-yazana-link");
    expect(utmSadelestir("İSTANBUL Güz Öğün Çay")).toBe("istanbul-guz-ogun-cay");
  });

  it("NOKTASIZ i (ı) tireye donmez — tek yuk tasiyan kural", () => {
    // NFD ayristirmasi s/g/u/o/c/İ'yi zaten cozuyor; "ı" birlesik isaret
    // tasimadigi icin cozulMUYOR ve ASCII olmadigi icin tireye dusuyordu.
    expect(utmSadelestir("Iğdır Öğün")).toBe("igdir-ogun");
    expect(utmSadelestir("ayrık kayıt")).toBe("ayrik-kayit");
    expect(utmSadelestir("Iğdır")).not.toContain("-");
  });

  it("bos ve bozuk girdide guvenli deger uretir", () => {
    expect(utmSadelestir("")).toBe("");
    expect(utmSadelestir("!!! ??? ***")).toBe("");
    expect(utmSadelestir("  bosluk  ")).toBe("bosluk");
  });

  it("uzunlugu sinirlar", () => {
    expect(utmSadelestir("a".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe("hedefeUtmEkle", () => {
  it("EKSIK ALANDA yonlendirmeyi kirmaz, etiketi atlar", () => {
    // Yonlendirme kritik yol: bir etiketleme detayi yuzunden 500 vermek,
    // etiketsiz yonlendirmekten cok daha kotudur.
    const sonuc = hedefeUtmEkle("https://ornek.com/s", {
      kampanyaAdi: undefined,
      slug: null,
    });
    const u = new URL(sonuc);

    expect(u.origin + u.pathname).toBe("https://ornek.com/s");
    expect(u.searchParams.get("utm_source")).toBe("instagram");
    expect(u.searchParams.get("utm_campaign")).toBe("kampanya"); // yedek
    expect(u.searchParams.has("utm_content")).toBe(false); // bos etiket yazilmaz
  });

  it("duz URL'e dort etiketi ekler", () => {
    const u = new URL(hedefeUtmEkle("https://ornek.com/sayfa", G));

    expect(u.searchParams.get("utm_source")).toBe("instagram");
    expect(u.searchParams.get("utm_medium")).toBe("openreply");
    expect(u.searchParams.get("utm_campaign")).toBe("city-sehir-promptu");
    expect(u.searchParams.get("utm_content")).toBe("city-054b62");
  });

  it("FRAGMENT'i korur ve sorguyu # ONUNE koyar", () => {
    // Gercek kampanya hedeflerimiz tam olarak boyle: .../promptlar/#gta
    const sonuc = hedefeUtmEkle(
      "https://www.yapayzekakademisi.com/promptlar/#papercut-sehir-posteri",
      G
    );

    expect(sonuc).toContain("?utm_source=instagram");
    expect(sonuc.endsWith("#papercut-sehir-posteri")).toBe(true);
    // Sorgu fragment'in ICINDE kalmamali.
    expect(sonuc.indexOf("?")).toBeLessThan(sonuc.indexOf("#"));
    expect(new URL(sonuc).hash).toBe("#papercut-sehir-posteri");
  });

  it("var olan parametreyi EZMEZ, digerlerini ekler", () => {
    const u = new URL(
      hedefeUtmEkle("https://ornek.com/s?utm_source=elle&x=1", G)
    );

    expect(u.searchParams.get("utm_source")).toBe("elle"); // kullanici kazanir
    expect(u.searchParams.get("x")).toBe("1"); // ilgisiz parametre durur
    expect(u.searchParams.get("utm_medium")).toBe("openreply"); // eksik olan eklenir
  });

  it("KARSI YON: web disi semaya DOKUNMAZ", () => {
    for (const adres of [
      "mailto:biri@ornek.com",
      "tel:+905551112233",
      "myapp://acilis?x=1",
    ]) {
      expect(hedefeUtmEkle(adres, G)).toBe(adres);
    }
  });

  it("KARSI YON: cozulemeyen adresi oldugu gibi dondurur", () => {
    for (const bozuk of ["", "sadece-metin", "http://"]) {
      expect(hedefeUtmEkle(bozuk, G)).toBe(bozuk);
    }
  });

  it("iki kez uygulamak URL'i BOZMAZ (idempotent)", () => {
    const bir = hedefeUtmEkle("https://ornek.com/s#bolum", G);
    const iki = hedefeUtmEkle(bir, G);

    expect(iki).toBe(bir);
    expect((iki.match(/utm_source/g) ?? []).length).toBe(1);
  });

  it("kampanya adi sadelestirilemiyorsa yedek deger kullanir", () => {
    const u = new URL(hedefeUtmEkle("https://ornek.com/s", { ...G, kampanyaAdi: "???" }));

    expect(u.searchParams.get("utm_campaign")).toBe("kampanya");
  });
});
