/**
 * Trend helpers — unit tests
 *
 * Timezone handling for the hour-of-day buckets (Intl instead of a fixed
 * offset), the bilingual CTA pattern, and the median.
 */

import { describe, expect, it } from "vitest";
import {
  CTA_PATTERN,
  CTA_PATTERN_EN,
  CTA_PATTERN_TR,
  DEFAULT_TIME_ZONE,
  halfYearLabel,
  localParts,
  median,
  resolveTimeZone,
} from "../lib/reports/trend-helpers";

describe("resolveTimeZone", () => {
  it("falls back to the default when nothing is supplied", () => {
    expect(resolveTimeZone(null)).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone(undefined)).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone("   ")).toBe(DEFAULT_TIME_ZONE);
  });

  it("accepts valid IANA names", () => {
    expect(resolveTimeZone("America/New_York")).toBe("America/New_York");
    expect(resolveTimeZone("UTC")).toBe("UTC");
  });

  it("rejects garbage so the route can answer 400", () => {
    expect(resolveTimeZone("Mars/Olympus_Mons")).toBeNull();
    expect(resolveTimeZone("+03:00 but not a zone")).toBeNull();
  });
});

describe("localParts", () => {
  it("shifts hour, month and year across midnight and new year", () => {
    // 2025-12-31 22:30 UTC is already 2026-01-01 01:30 in Istanbul (UTC+3).
    const parts = localParts(new Date("2025-12-31T22:30:00Z"), "Europe/Istanbul");
    expect(parts).toEqual({ year: 2026, month: 1, hour: 1 });
  });

  it("honours daylight saving, which a fixed offset cannot", () => {
    // New York is UTC-4 in July and UTC-5 in January. A fixed offset would get
    // one of these wrong by an hour.
    expect(localParts(new Date("2026-07-15T12:00:00Z"), "America/New_York").hour).toBe(8);
    expect(localParts(new Date("2026-01-15T12:00:00Z"), "America/New_York").hour).toBe(7);
  });

  it("renders midnight as hour 0, never 24", () => {
    expect(localParts(new Date("2026-03-10T00:00:00Z"), "UTC").hour).toBe(0);
  });
});

describe("halfYearLabel", () => {
  it("splits at June/July", () => {
    expect(halfYearLabel({ year: 2026, month: 6, hour: 0 })).toBe("2026 H1");
    expect(halfYearLabel({ year: 2026, month: 7, hour: 0 })).toBe("2026 H2");
  });
});

describe("CTA_PATTERN", () => {
  it("matches the Turkish wording", () => {
    expect(CTA_PATTERN_TR.test("Detaylar için yorumlara yaz")).toBe(true);
    expect(CTA_PATTERN.test("Takip et ve kazan")).toBe(true);
  });

  it("matches the English wording", () => {
    expect(CTA_PATTERN_EN.test("Link in bio for the full guide")).toBe(true);
    expect(CTA_PATTERN.test("DM me the word START")).toBe(true);
    expect(CTA_PATTERN.test("Comment YES below")).toBe(true);
  });

  it("does not fire on a caption with no call to action", () => {
    expect(CTA_PATTERN.test("Bugün İstanbul'da güzel bir gün")).toBe(false);
    expect(CTA_PATTERN.test("Sunset over the bay")).toBe(false);
  });
});

describe("median", () => {
  it("handles empty, odd and even lengths", () => {
    expect(median([])).toBe(0);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(3); // (2+3)/2 rounded
  });

  it("does not mutate its input", () => {
    const values = [9, 1, 5];
    median(values);
    expect(values).toEqual([9, 1, 5]);
  });
});
