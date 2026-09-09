/**
 * Webhook siniflandirma.
 *
 * Panel `workspaceId === null` olan HER satiri "unmatched" diye amber
 * isaretliyordu: son 7 gunde 2.471 olayin 2.034'u (%82). Operator bunu
 * "webhook'larin dortte ucu duşuyor" diye okur. Gercekte onlarin cogu
 * kendi yankimiz ve tasarim geregi islenmiyor.
 */
import { describe, it, expect } from "vitest";
import {
  webhookAktoru,
  webhookOzeti,
  webhookSinifi,
  yankiMi,
} from "@/lib/ops/webhook-siniflandirma";

const BIZ = "17841465942418709";
const KENDI = new Set([BIZ]);

/** Canli yuklerden birebir alinmis sekiller. */
const yorumOlayi = (fromId: string) => ({
  entry: [
    {
      id: BIZ,
      changes: [{ field: "comments", value: { id: "c1", from: { id: fromId } } }],
    },
  ],
});
const mesajOlayi = (senderId: string, echo = false) => ({
  entry: [
    {
      id: BIZ,
      messaging: [
        { sender: { id: senderId }, message: echo ? { is_echo: true } : { text: "selam" } },
      ],
    },
  ],
});

describe("aktoru cikarma", () => {
  it("yorum olayinda from.id, mesaj olayinda sender.id", () => {
    expect(webhookAktoru(yorumOlayi("999"))).toBe("999");
    expect(webhookAktoru(mesajOlayi("888"))).toBe("888");
  });

  it("taninmayan sekilde COKMEZ, null doner", () => {
    // Sekli varsaymak yerine okuyoruz: Meta yeni bir alan eklerse panel
    // patlamamali.
    for (const bozuk of [null, undefined, {}, { entry: [] }, { entry: [{}] }, "metin", 42]) {
      expect(webhookAktoru(bozuk)).toBeNull();
    }
  });
});

describe("siniflandirma", () => {
  it("workspaceId varsa ESLESTI — yuke hic bakmaz", () => {
    expect(webhookSinifi("ws_1", yorumOlayi("999"), KENDI)).toBe("eslesti");
  });

  it("kendi yorum cevabimiz KENDI-YANKISI", () => {
    // Kendi cevabimiza cevap vermek sonsuz dongu olurdu.
    expect(webhookSinifi(null, yorumOlayi(BIZ), KENDI)).toBe("kendi-yankisi");
  });

  it("kendi giden DM'imiz (is_echo) KENDI-YANKISI", () => {
    expect(webhookSinifi(null, mesajOlayi(BIZ, true), KENDI)).toBe("kendi-yankisi");
  });

  it("is_echo TRUE ise gonderen baskasi olsa da yanki sayilir", () => {
    // Meta echo'yu bazen farkli bir kimlikle yolluyor; bayrak esas.
    expect(webhookSinifi(null, mesajOlayi("999", true), KENDI)).toBe("kendi-yankisi");
  });

  it("KARSI YON: akista olmayan birinin DM'i AKIS-DISI, yanki DEGIL", () => {
    expect(webhookSinifi(null, mesajOlayi("999"), KENDI)).toBe("akis-disi");
    expect(webhookSinifi(null, yorumOlayi("999"), KENDI)).toBe("akis-disi");
  });

  it("kendi kimlik listesi BOSSA hicbir sey yanki sayilmaz", () => {
    // Hesap kimligi okunamadiginda sessizce "hepsi yanki" demek gercek bir
    // ariza modunu gizlerdi.
    expect(webhookSinifi(null, yorumOlayi(BIZ), new Set())).toBe("akis-disi");
    // is_echo bayragi yine de gecerli — o yuke ait, hesaba degil.
    expect(webhookSinifi(null, mesajOlayi(BIZ, true), new Set())).toBe("kendi-yankisi");
  });
});

describe("ozet", () => {
  it("uc sinifi ayri sayar ve toplam korunur", () => {
    const olaylar = [
      { workspaceId: "ws_1", payload: yorumOlayi("111") },
      { workspaceId: null, payload: yorumOlayi(BIZ) },
      { workspaceId: null, payload: mesajOlayi(BIZ, true) },
      { workspaceId: null, payload: mesajOlayi("222") },
      { workspaceId: null, payload: mesajOlayi("333") },
    ];

    const o = webhookOzeti(olaylar, KENDI);

    expect(o).toEqual({ eslesti: 1, "kendi-yankisi": 2, "akis-disi": 2 });
    // Bolumleme kontrolu: parcalarin toplami butunu asamaz ve eksik de kalamaz.
    expect(o.eslesti + o["kendi-yankisi"] + o["akis-disi"]).toBe(olaylar.length);
  });

  it("bos listede sifirlar doner, cokmez", () => {
    expect(webhookOzeti([], KENDI)).toEqual({
      eslesti: 0,
      "kendi-yankisi": 0,
      "akis-disi": 0,
    });
  });
});

describe("yankiMi", () => {
  it("yalnizca is_echo === true icin true", () => {
    expect(yankiMi(mesajOlayi("1", true))).toBe(true);
    expect(yankiMi(mesajOlayi("1", false))).toBe(false);
    expect(yankiMi(yorumOlayi("1"))).toBe(false);
    expect(yankiMi(null)).toBe(false);
  });
});
