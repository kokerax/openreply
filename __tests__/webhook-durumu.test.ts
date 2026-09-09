/**
 * Webhook rozeti bayraktan degil davranistan turemeli.
 *
 * Canli: `webhookSubscribed=false` iken son 24 saatte 502 olay gelmisti ve
 * panel calisan baglantiya "Webhook pending" diyordu.
 */
import { describe, it, expect } from "vitest";
import { webhookDurumu, webhookRozeti } from "@/lib/ops/webhook-durumu";

const SIMDI = new Date("2026-09-09T12:00:00Z");
const saatOnce = (n: number) => new Date(SIMDI.getTime() - n * 3600_000);

describe("durum", () => {
  it("ASIL VAKA: bayrak false ama olay geliyorsa 'bayrak-bayat'", () => {
    expect(webhookDurumu(false, saatOnce(2), SIMDI)).toBe("bayrak-bayat");
  });

  it("bayrak true ve olay geliyorsa 'calisiyor'", () => {
    expect(webhookDurumu(true, saatOnce(2), SIMDI)).toBe("calisiyor");
  });

  it("bayrak true ama olay yoksa 'abone-sessiz' — ariza ILAN ETMEZ", () => {
    // Sessiz bir hesap da olaysizdir; ikisini ayirt edemedigimiz icin
    // alarm uydurmuyoruz.
    expect(webhookDurumu(true, null, SIMDI)).toBe("abone-sessiz");
    expect(webhookDurumu(true, saatOnce(50), SIMDI)).toBe("abone-sessiz");
  });

  it("KARSI YON: ne bayrak ne olay varsa gercekten 'bekliyor'", () => {
    expect(webhookDurumu(false, null, SIMDI)).toBe("bekliyor");
    expect(webhookDurumu(false, saatOnce(50), SIMDI)).toBe("bekliyor");
  });

  it("24 saat SINIRI: 23 saat taze, 25 saat degil", () => {
    expect(webhookDurumu(false, saatOnce(23), SIMDI)).toBe("bayrak-bayat");
    expect(webhookDurumu(false, saatOnce(25), SIMDI)).toBe("bekliyor");
  });

  it("gecersiz tarih cokmez, olaysiz sayilir", () => {
    expect(webhookDurumu(false, "olmayan-tarih", SIMDI)).toBe("bekliyor");
    expect(webhookDurumu(true, undefined, SIMDI)).toBe("abone-sessiz");
  });
});

describe("rozet", () => {
  it("celiski GIZLENMEZ, ipucunda yazili", () => {
    const r = webhookRozeti("bayrak-bayat");
    expect(r.status).toBe("ACTIVE");
    expect(r.hint).toMatch(/stale/i);
  });

  it("yalnizca gercek 'bekliyor' amber", () => {
    expect(webhookRozeti("bekliyor").status).toBe("PENDING");
    for (const d of ["calisiyor", "bayrak-bayat", "abone-sessiz"] as const) {
      expect(webhookRozeti(d).status).toBe("ACTIVE");
    }
  });
});
