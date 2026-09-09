/**
 * DM onizlemesi.
 *
 * Inbox 50 sohbetin 32'sinde "(no text)" gosteriyordu (%64). Fixture uydurma
 * degil: asagidaki sekiller canli Graph API yanitindan birebir alindi.
 */
import { describe, it, expect } from "vitest";
import { mesajOnizlemesi } from "@/lib/meta/mesaj-onizleme";

/** Canli yanittan birebir: bizim kampanya DM'imiz. */
const BUTONLU = {
  message: "",
  attachments: {
    data: [
      {
        generic_template: {
          title:
            "🙋‍♂️ Merhaba _enes_mayda_ , yorumun için teşekkürler!\nVideolarda bahsettiğim yapay zeka araçları takipçilerime özeldir, almak için aşağıdaki butona tıkla",
          cta: [{ title: "YOLLA", type: "postback" }],
        },
      },
    ],
  },
};

/** Canli yanittan birebir: kisi bize reel paylasmis. */
const PAYLASIM = {
  message: "",
  shares: { data: [{ link: "https://www.instagram.com/reel/Dcp55ccIUsT/" }] },
};

describe("duz metin varsa oldugu gibi", () => {
  it("metni dondurur", () => {
    expect(mesajOnizlemesi({ message: "Merhaba, video linki burada" })).toBe(
      "Merhaba, video linki burada"
    );
  });

  it("bosluk kirpilir ve BOS metin ek aramaya devam eder", () => {
    expect(mesajOnizlemesi({ message: "  selam  " })).toBe("selam");
    // Sadece bosluk = metin yok; ek varsa o gosterilmeli.
    expect(mesajOnizlemesi({ ...PAYLASIM, message: "   " })).toContain("reel");
  });
});

describe("butonlu kampanya mesaji — ASIL vaka", () => {
  it("sablonun basligini gosterir, buton etiketiyle", () => {
    const o = mesajOnizlemesi(BUTONLU);
    expect(o).toContain("yorumun için teşekkürler");
    expect(o).toContain("[YOLLA]");
    // Eskiden burada bos dize doner ve panel "(no text)" yazardi.
    expect(o).not.toBe("");
  });

  it("basliksiz sablon bile 'butonlu mesaj' der, BOS DEGIL", () => {
    const o = mesajOnizlemesi({
      message: "",
      attachments: { data: [{ generic_template: { cta: [{ title: "AÇ" }] } }] },
    });
    expect(o).toBe("(butonlu mesaj) [AÇ]");
  });

  it("butonsuz sablonda koseli parantez YAZILMAZ", () => {
    expect(
      mesajOnizlemesi({
        message: "",
        attachments: { data: [{ generic_template: { title: "selam" } }] },
      })
    ).toBe("selam");
  });
});

describe("diger ek turleri sessizce bos kalmaz", () => {
  it("gonderi paylasimini linkiyle gosterir", () => {
    expect(mesajOnizlemesi(PAYLASIM)).toBe(
      "(gönderi paylaştı) https://www.instagram.com/reel/Dcp55ccIUsT/"
    );
  });

  it("gorsel, video ve dosya ayri ayri etiketlenir", () => {
    expect(mesajOnizlemesi({ attachments: { data: [{ image_data: {} }] } })).toBe("(görsel)");
    expect(mesajOnizlemesi({ attachments: { data: [{ video_data: {} }] } })).toBe("(video)");
    expect(mesajOnizlemesi({ attachments: { data: [{ file_url: "u" }] } })).toBe("(dosya)");
  });

  it("TANINMAYAN ek turu 'ek' der — sessizce bos DEGIL", () => {
    // Meta yeni bir tur eklerse panel yine "(no text)" davranisina donmemeli.
    expect(mesajOnizlemesi({ attachments: { data: [{ type: "sticker" }] } })).toBe(
      "(sticker)"
    );
    expect(mesajOnizlemesi({ attachments: { data: [{}] } })).toBe("(ek)");
  });

  it("hikaye baglantisi gosterilir", () => {
    expect(mesajOnizlemesi({ story: { link: "https://x/story" } })).toBe(
      "(hikâye) https://x/story"
    );
  });
});

describe("GERCEK ICERIK genel ek etiketini yener", () => {
  it("gorsel eki VE gonderi paylasimi varsa LINK gosterilir", () => {
    // Ilk surumde `attachments` dali kosulsuz donuyordu: mesaj hem gorsel
    // eki hem paylasim tasidiginda "(görsel)" yazip linki kaybediyordu.
    const o = mesajOnizlemesi({
      message: "",
      attachments: { data: [{ image_data: {} }] },
      shares: { data: [{ link: "https://instagram.com/reel/X/" }] },
    });
    expect(o).toContain("reel/X");
  });

  it("KARSI YON: paylasim YOKSA ek etiketi yine gosterilir", () => {
    expect(mesajOnizlemesi({ message: "", attachments: { data: [{ image_data: {} }] } })).toBe(
      "(görsel)"
    );
  });

  it("sablon basligi paylasimdan ONCE gelir", () => {
    // Butonlu kampanya mesajinin kendi metni her seyi yener.
    const o = mesajOnizlemesi({
      ...BUTONLU,
      shares: { data: [{ link: "https://instagram.com/reel/Y/" }] },
    });
    expect(o).toContain("teşekkürler");
  });
});

describe("bos ve bozuk girdide cokmez", () => {
  it("null/undefined/bos nesne BOS dize dondurur", () => {
    for (const g of [null, undefined, {}, { message: "" }]) {
      expect(mesajOnizlemesi(g)).toBe("");
    }
  });

  it("bos dizili alanlar cokertmez", () => {
    expect(mesajOnizlemesi({ attachments: { data: [] } })).toBe("");
    expect(mesajOnizlemesi({ shares: { data: [] } })).toBe("");
  });

  it("SIRALAMA: duz metin ekten ONCE gelir", () => {
    // Ikisi birden varsa insanin yazdigi metin gosterilmeli.
    expect(mesajOnizlemesi({ ...BUTONLU, message: "gercek metin" })).toBe(
      "gercek metin"
    );
  });
});
