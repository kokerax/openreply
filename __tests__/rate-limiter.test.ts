/**
 * Hız sınırlayıcı — birim testleri (Postgres tabanlı).
 *
 * Eski Redis sürümünün yerini `lib/utils/pg-rate-limiter` aldı; kuyruk
 * Postgres'e taşınınca Redis tamamen kalktı. Testler iki pencereyi de
 * kapsıyor, çünkü ikisi de gerçek bir olaydan doğdu:
 *
 *   - SAATLIK 750: Meta'nın dokümante ettiği tavan.
 *   - DAKIKALIK 8: asıl bağlayıcı sınır. 2026-08-30 ölçümü — 20+/dk'da hata
 *     oranı %26,1, altındaki bantlarda %0-2,8; 54 hatanın 48'i 4 dakikada.
 *
 * Kontrol çifti önemli: sınırın TUTTUĞUNU test etmek yetmez, tutmadığı yerde
 * SERBEST BIRAKTIĞINI da test etmek gerekir — yoksa "her şeyi engelle" de geçer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockQueryRaw, mockFindUnique } = vi.hoisted(() => ({
  mockQueryRaw: vi.fn(),
  mockFindUnique: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    $queryRaw: mockQueryRaw,
    rateCounter: { findUnique: mockFindUnique, deleteMany: vi.fn() },
  },
}));

import { reserveDMSlot, checkRateLimit } from "../lib/utils/pg-rate-limiter";

/** Slot ayırma SQL'i satır döndürürse slot alınmış, boş dizi dönerse dolu. */
function slotVerildi(sayi: number) {
  return [{ count: sayi }];
}
const SLOT_DOLU: unknown[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUnique.mockResolvedValue(null);
});

describe("reserveDMSlot — patlama penceresi", () => {
  it("slot varken izin verir ve rezerve eder", async () => {
    mockQueryRaw.mockResolvedValue(slotVerildi(1));
    const r = await reserveDMSlot("ig_1", 0);
    expect(r.allowed).toBe(true);
    expect(r.reserved).toBe(true);
    // Iki pencere de sorgulanmali: once patlama, sonra saatlik.
    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
  });

  it("patlama penceresi dolunca engeller ve KISA bekleme verir", async () => {
    mockQueryRaw.mockResolvedValueOnce(SLOT_DOLU); // patlama dolu
    mockFindUnique.mockResolvedValue({ count: 8, expiresAt: new Date(Date.now() + 30_000) });
    const r = await reserveDMSlot("ig_1", 0);
    expect(r.allowed).toBe(false);
    expect(r.shouldRequeue).toBe(true);
    expect(r.shouldSkip).toBe(false);
    // Bekledigi pencere BIR DAKIKA uzunlugunda; saatlik engelin 30 dakikasi degil.
    expect(r.requeueDelayMs).toBeGreaterThan(60_000);
    expect(r.requeueDelayMs).toBeLessThan(120_000);
  });

  it("patlama engelinde saatlik slot TUKETILMEZ", async () => {
    mockQueryRaw.mockResolvedValueOnce(SLOT_DOLU);
    await reserveDMSlot("ig_1", 0);
    // Patlama gatesi once bakildigi icin saatlik sorgu HIC calismamali —
    // yoksa engellenen is, kullanamayacagi saatlik slotu yerdi.
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it("dalga sabri: 10. tekrarda hala kuyrukta tutar", async () => {
    mockQueryRaw.mockResolvedValueOnce(SLOT_DOLU);
    const r = await reserveDMSlot("ig_1", 10);
    expect(r.shouldRequeue).toBe(true);
    expect(r.shouldSkip).toBe(false);
  });

  it("sabir tukenince atlar (kontrol cifti)", async () => {
    mockQueryRaw.mockResolvedValueOnce(SLOT_DOLU);
    const r = await reserveDMSlot("ig_1", 30);
    expect(r.shouldSkip).toBe(true);
    expect(r.shouldRequeue).toBe(false);
  });
});

describe("reserveDMSlot — saatlik pencere", () => {
  it("saatlik tavan dolunca UZUN bekleme verir", async () => {
    mockQueryRaw
      .mockResolvedValueOnce(slotVerildi(3)) // patlama serbest
      .mockResolvedValueOnce(SLOT_DOLU); // saatlik dolu
    mockFindUnique.mockResolvedValue({ count: 750, expiresAt: new Date(Date.now() + 600_000) });
    const r = await reserveDMSlot("ig_1", 0);
    expect(r.allowed).toBe(false);
    expect(r.shouldRequeue).toBe(true);
    // Saatlik pencerede beklenen sure dakikalik olandan cok daha uzun olmali.
    expect(r.requeueDelayMs).toBeGreaterThan(10 * 60_000);
  });

  it("saatlik engelde 3 tekrardan sonra atlar", async () => {
    mockQueryRaw.mockResolvedValueOnce(slotVerildi(3)).mockResolvedValueOnce(SLOT_DOLU);
    mockFindUnique.mockResolvedValue({ count: 750, expiresAt: new Date(Date.now() + 600_000) });
    const r = await reserveDMSlot("ig_1", 3);
    expect(r.shouldSkip).toBe(true);
  });
});

describe("checkRateLimit — yazmadan bakar", () => {
  it("sayac yokken izin verir ve HIC yazmaz", async () => {
    mockFindUnique.mockResolvedValue(null);
    const r = await checkRateLimit("ig_1", 0);
    expect(r.allowed).toBe(true);
    expect(r.reserved).toBe(false);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it("suresi dolmus sayaci SIFIR sayar", async () => {
    // Gecmis bir expiresAt: pencere kapanmis demektir, sayi tasinmamali.
    mockFindUnique.mockResolvedValue({ count: 750, expiresAt: new Date(Date.now() - 1000) });
    const r = await checkRateLimit("ig_1", 0);
    expect(r.allowed).toBe(true);
  });
});
