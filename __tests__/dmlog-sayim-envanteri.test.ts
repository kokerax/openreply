/**
 * DmLog sayan HER yolun kapsami bilinerek secilmis olmali.
 *
 * ## Neden bu test var
 *
 * Ayni hata — "sentetik defter satirlarini yorum sanmak" — bu oturumda BES
 * ayri yolda ortaya cikti:
 *
 *   1. yorum cevabi kurtarmasi (her saat 15 sentetik satir kuyrukluyordu)
 *   2. dashboard karti ("DMs Sent 666" derken dagilim 419 diyordu)
 *   3. kampanya hunisi (CTR %25 gorunuyordu, gercegi %53)
 *   4. kampanya listesi (GTA "305 runs / 244 sent", gercegi 122 / 116)
 *   5. MUSTERIYE giden paylasilan rapor
 *
 * `SADECE_YORUM` sabiti ucuncu tekrardan sonra yazildi ama YETMEDI: sabitin
 * varligi kimseyi onu cagirmaya zorlamiyor. Yeni bir sayim yolu eklendiginde
 * hicbir sey uyarmiyordu.
 *
 * Bu test o boslugu kapatir. Her sayim yolu asagidaki envanterde kayitli
 * olmali ve kapsami ACIKCA secilmis olmali:
 *
 *   "yorum" — yalnizca gercek yorumlar (`SADECE_YORUM` zorunlu)
 *   "tum"   — butun mesajlar; defter satirlari da gercek gonderim sayilir
 *
 * Envanterde olmayan bir yol testi KIRAR. Bu, yeni yolu yazan kisiyi
 * "bu sorgu hangi evreni sayiyor" sorusunu cevaplamaya zorlar — kararin
 * kendisi hala insanin, ama artik sessizce atlanamiyor.
 *
 * Not: bu test kaynak metnini tariyor, yani kendi basina davranis
 * kanitlamaz. Davranis kanitini her yuzeyin KENDI testi veriyor (rotayi
 * cagirip sayilari olcuyorlar). Buranin isi yalnizca YENI bir yolun fark
 * edilmeden eklenmesini engellemek.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

type Kapsam = "yorum" | "tum";

/**
 * Bilinen sayim yollari. Anahtar dosya yolu, deger o dosyadaki her yolun
 * kapsami ve NEDEN oyle oldugu.
 */
const ENVANTER: Record<string, { kapsam: Kapsam; neden: string }> = {
  "app/api/dashboard/stats/route.ts": {
    kapsam: "yorum",
    neden:
      "KPI, gunluk grafik ve kaynak dagilimi ayni evrenden sayilmali; " +
      "takip mesajlari `followUpMessages` alaninda ayrica raporlaniyor.",
  },
  "app/api/automations/route.ts": {
    kapsam: "yorum",
    neden: "Kampanya listesindeki runs/sent/CTR kampanya performansi anlatiyor.",
  },
  "app/api/automations/[id]/analytics/route.ts": {
    kapsam: "yorum",
    neden: "Huni 'yorum -> DM -> tiklama' anlatiyor; payda sisemez.",
  },
  "lib/reports/data.ts": {
    kapsam: "yorum",
    neden: "MUSTERIYE giden paylasilan rapor; yanlis evrenin en yuksek bedeli.",
  },
  "lib/ops/gonderi-performansi.ts": {
    kapsam: "yorum",
    neden: "Defter satirlarinin medyasi YOKTUR, gonderi kirilimina giremez.",
  },
  "lib/ops/eposta-kapisi.ts": {
    kapsam: "tum",
    neden:
      "BILEREK yalnizca `emailgate:` defter satirlarini sayiyor — " +
      "`sadeceTur('emailgate')` ile; huninin konusu zaten o satirlar.",
  },
  "app/api/logs/route.ts": {
    kapsam: "tum",
    neden: "Log listesi; sayim listelenen satirlarin sayisi, ayni evren.",
  },
  "app/api/admin/diagnostics/route.ts": {
    kapsam: "tum",
    neden:
      "Hata dokumu: defter satirlari da basarisiz olabilir ve o hatalar " +
      "teshis icin gerekli.",
  },
  "app/api/cron/teslimat-denetimi/route.ts": {
    kapsam: "tum",
    neden:
      "Alarm 'mesaj gidiyor mu' diye soruyor; pay ve payda ikisi de tum " +
      "mesajlar, yani oran zaten ayni evrenden.",
  },
};

const KOKLER = ["app", "lib", "worker", "components"];
const DESEN = /prisma\.dmLog\.(count|groupBy|aggregate)\s*\(|dmLogs:\s*\{/;

function kaynakDosyalari(): string[] {
  const cikti: string[] = [];
  const gez = (dizin: string) => {
    for (const giris of fs.readdirSync(dizin, { withFileTypes: true })) {
      const tam = path.join(dizin, giris.name);
      if (giris.isDirectory()) {
        // Uretilen Prisma istemcisi kendi ornek kodunu tasiyor.
        if (giris.name === "generated" || giris.name === "node_modules") continue;
        gez(tam);
      } else if (/\.tsx?$/.test(giris.name)) {
        cikti.push(tam);
      }
    }
  };
  for (const kok of KOKLER) {
    const p = path.join(process.cwd(), kok);
    if (fs.existsSync(p)) gez(p);
  }
  return cikti;
}

/** Sayim yapan dosyalar -> o dosyadaki yol sayisi. */
function sayimYollari(): Map<string, number> {
  const harita = new Map<string, number>();
  for (const dosya of kaynakDosyalari()) {
    const govde = fs.readFileSync(dosya, "utf8");
    const adet = govde.split("\n").filter((l) => DESEN.test(l)).length;
    if (adet > 0) {
      harita.set(path.relative(process.cwd(), dosya), adet);
    }
  }
  return harita;
}

/**
 * Bir sayim cagrisinin ARGUMAN GOVDESINI cikarir (parantez/kume dengesiyle).
 * Satir bazli bakmak yetmiyor: `where` blogu cagrinin onlarca satir altinda
 * olabiliyor.
 */
function sayimCagrilari(govde: string): string[] {
  const cikti: string[] = [];
  const baslangic = /prisma\.dmLog\.(?:count|groupBy|aggregate)\s*\(|dmLogs:\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = baslangic.exec(govde))) {
    let i = m.index + m[0].length - 1; // acilis parantezi/kumesi
    let derinlik = 0;
    const bas = i;
    for (; i < govde.length; i++) {
      const ch = govde[i];
      if (ch === "(" || ch === "{" || ch === "[") derinlik += 1;
      else if (ch === ")" || ch === "}" || ch === "]") {
        derinlik -= 1;
        if (derinlik === 0) break;
      }
    }
    cikti.push(govde.slice(bas, i + 1));
  }
  return cikti;
}

describe("DmLog sayan her yol envanterde kayitli", () => {
  it("kayitsiz YENI bir sayim yolu testi kirar", () => {
    const bulunan = sayimYollari();
    const kayitsiz = [...bulunan.keys()].filter((d) => !(d in ENVANTER));

    expect(
      kayitsiz,
      `Yeni DmLog sayim yolu bulundu. Bu sorgu HANGI evreni saymali?\n` +
        `  "yorum" -> where'e ...SADECE_YORUM ekle\n` +
        `  "tum"   -> bilerek boyle oldugunu yaz\n` +
        `Sonra ${path.basename(__filename)} icindeki ENVANTER'e ekle:\n` +
        kayitsiz.map((d) => `  - ${d}`).join("\n")
    ).toEqual([]);

    // Bir koruma araci kac birim taradigini HEP yazmali: sessizce hicbir sey
    // bulmamak ile "temiz" demek ayni ciktiya benzememeli.
    expect(bulunan.size).toBeGreaterThanOrEqual(9);
    const toplamYol = [...bulunan.values()].reduce((t, n) => t + n, 0);
    expect(toplamYol).toBeGreaterThanOrEqual(20);
  });

  it("'yorum' kapsamli her CAGRI YERI SADECE_YORUM tasiyor", () => {
    // ILK SURUM KORDU: dosyada `SADECE_YORUM` GECIYOR MU diye bakiyordu.
    // `lib/reports/data.ts` icinde uc tane vardi; kontrol mutasyonu ikisini
    // silince biri kaldi ve test YESIL kaldi — yani sorgularin ikisi yanlis
    // evreni sayarken koruma sustu. Sinyal artik dosya degil CAGRI YERI.
    const eksik: string[] = [];
    let taranan = 0;

    for (const [dosya, { kapsam }] of Object.entries(ENVANTER)) {
      if (kapsam !== "yorum") continue;
      const govde = fs.readFileSync(path.join(process.cwd(), dosya), "utf8");
      // Ayni dosyada tanimlanmis ve SADECE_YORUM tasiyan kapsam degiskenleri
      // (`const yorumKapsami = { ...dmScope, ...SADECE_YORUM }`) dolayli
      // kanit sayilir — sorgu onu yayiyorsa filtre yine uygulaniyor.
      const kapsamAdlari = [
        ...govde.matchAll(/const\s+(\w+)\s*=\s*\{[^}]*\.\.\.SADECE_YORUM/g),
      ].map((m) => m[1]);

      for (const cagri of sayimCagrilari(govde)) {
        taranan += 1;
        const tasiyor =
          /\.\.\.SADECE_YORUM/.test(cagri) ||
          kapsamAdlari.some((ad) => new RegExp(`\\b${ad}\\b`).test(cagri));
        if (!tasiyor) {
          eksik.push(`${dosya}: ${cagri.replace(/\s+/g, " ").slice(0, 70)}`);
        }
      }
    }

    expect(eksik, "Bu sayim yerleri 'yorum' kapsaminda ama filtreyi tasimiyor").toEqual([]);
    // Kac cagri yeri denetlendigi gizlenmez.
    expect(taranan).toBeGreaterThanOrEqual(12);
  });

  it("envanterde artik var olmayan dosya BIRAKILMAZ", () => {
    // Bayat envanter, korumanin sessizce daralmasi demektir.
    const olmayan = Object.keys(ENVANTER).filter(
      (d) => !fs.existsSync(path.join(process.cwd(), d))
    );
    expect(olmayan).toEqual([]);
  });
});
