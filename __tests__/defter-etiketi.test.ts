/**
 * Defter etiketleri tek dilde gorunmeli.
 *
 * DM Logs tablosunun ayni sutununda "(button tap)" ile "(e-posta alindi)"
 * yan yana duruyordu; panelin geri kalani Ingilizce.
 */
import { describe, it, expect } from "vitest";
import { defterEtiketi } from "@/lib/queue/defter-etiketi";

describe("bilinen etiketler cevrilir", () => {
  it("canli veride bulunan dort etiketin hepsi", () => {
    expect(defterEtiketi("(e-posta bekleniyor)")).toBe("(waiting for email)");
    expect(defterEtiketi("(e-posta alindi)")).toBe("(email received)");
    expect(defterEtiketi("(takip istemi)")).toBe("(follow prompt)");
    expect(defterEtiketi("(button tap)")).toBe("(button tap)");
  });

  it("Turkce karakterli yazim da eslesir", () => {
    // Kaynak zaman icinde "alindi" ve "alındı" olarak iki turlu yazilmis
    // olabilir; ikisi de ayni yere gitmeli.
    expect(defterEtiketi("(e-posta alındı)")).toBe("(email received)");
  });

  it("bosluklu yazim eslesir", () => {
    expect(defterEtiketi("  (takip istemi)  ")).toBe("(follow prompt)");
  });
});

describe("KARSI YON: gercek yorum metnine dokunulmaz", () => {
  it("kisinin yazdigi metin oldugu gibi doner", () => {
    // `dm:` satirlari gercek DM metnini tasiyor; cevirmek veriyi bozardi.
    for (const m of ["Chatgpt", "GTA", "CHATGBT", "city", "(e-posta)", "takip istemi"]) {
      expect(defterEtiketi(m)).toBe(m);
    }
  });

  it("bos ve null guvenli", () => {
    expect(defterEtiketi(null)).toBe("");
    expect(defterEtiketi(undefined)).toBe("");
    expect(defterEtiketi("")).toBe("");
  });
});
