/**
 * Saat dilimine gore gun siniri.
 *
 * Kusur: dashboard "bugun"u SUNUCUNUN yerel saatinden hesapliyordu. Vercel
 * UTC'de kostugu icin Istanbul'daki kullaniciya bugun 03:00'te basliyordu;
 * gece yarisi ile 03:00 arasindaki gonderimler "bugun" sayilmiyordu.
 */
import { describe, it, expect } from "vitest";
import { bolgedeGunBasi, yerelGunAnahtari } from "@/lib/reports/trend-helpers";

describe("yerelGunAnahtari", () => {
  it("ayni ani farkli bolgelerde FARKLI gune koyar", () => {
    // 2026-09-09 01:00 UTC = Istanbul'da 04:00 (ayni gun),
    // New York'ta 2026-09-08 21:00 (ONCEKI gun).
    const an = new Date("2026-09-09T01:00:00Z");

    expect(yerelGunAnahtari(an, "Europe/Istanbul")).toBe("2026-09-09");
    expect(yerelGunAnahtari(an, "UTC")).toBe("2026-09-09");
    expect(yerelGunAnahtari(an, "America/New_York")).toBe("2026-09-08");
  });

  it("Istanbul'da gece yarisi ile 03:00 arasi ONCEKI UTC gunundedir", () => {
    // Tam kusurun oldugu pencere: 2026-09-09 00:30 Istanbul = 21:30 UTC 09-08.
    const an = new Date("2026-09-08T21:30:00Z");

    expect(yerelGunAnahtari(an, "Europe/Istanbul")).toBe("2026-09-09");
    expect(yerelGunAnahtari(an, "UTC")).toBe("2026-09-08"); // eski davranis
  });
});

describe("bolgedeGunBasi", () => {
  it("Istanbul'da gun basi UTC 21:00'dir (+03)", () => {
    const simdi = new Date("2026-09-09T01:00:00Z"); // 04:00 Istanbul
    const bas = bolgedeGunBasi("Europe/Istanbul", simdi);

    expect(bas.toISOString()).toBe("2026-09-08T21:00:00.000Z");
    // Gun basi HER ZAMAN simdiden once olmali.
    expect(bas.getTime()).toBeLessThanOrEqual(simdi.getTime());
    // Ve 24 saatten fazla geride olmamali.
    expect(simdi.getTime() - bas.getTime()).toBeLessThan(24 * 3600_000);
  });

  it("UTC bolgesinde eski davranisla AYNI kalir", () => {
    const simdi = new Date("2026-09-09T01:00:00Z");
    expect(bolgedeGunBasi("UTC", simdi).toISOString()).toBe("2026-09-09T00:00:00.000Z");
  });

  it("DST gecisinde dogru: New York yaz saati (-04)", () => {
    const simdi = new Date("2026-07-15T12:00:00Z"); // 08:00 EDT
    expect(bolgedeGunBasi("America/New_York", simdi).toISOString()).toBe(
      "2026-07-15T04:00:00.000Z"
    );
  });

  it("DST gecisinde dogru: New York kis saati (-05)", () => {
    const simdi = new Date("2026-01-15T12:00:00Z"); // 07:00 EST
    expect(bolgedeGunBasi("America/New_York", simdi).toISOString()).toBe(
      "2026-01-15T05:00:00.000Z"
    );
  });

  it("her bolgede gun basi o bolgede gercekten GECE YARISI'dir", () => {
    // Sabit ofsetle hesaplayan bir uygulama DST gunlerinde bunu kacirir.
    for (const tz of [
      "Europe/Istanbul",
      "America/New_York",
      "Asia/Kolkata", // +05:30, yarim saatli ofset
      "Australia/Sydney",
      "UTC",
    ]) {
      for (const gun of ["2026-03-29T10:00:00Z", "2026-11-01T10:00:00Z"]) {
        const bas = bolgedeGunBasi(tz, new Date(gun));
        const saat = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          hourCycle: "h23",
          hour: "numeric",
          minute: "numeric",
        }).format(bas);
        expect(`${tz} ${gun} -> ${saat}`).toBe(`${tz} ${gun} -> 00:00`);
      }
    }
  });
});
