/**
 * Pure helpers for the trend analysis endpoint (app/api/instagram/trend).
 * Kept out of the route file so they can be unit-tested without auth/prisma.
 */

/**
 * Used when the request carries no `tz`. Istanbul because the accounts this
 * instance was built for post from there; the page always sends the browser's
 * zone, so this only applies to bare API calls.
 */
export const DEFAULT_TIME_ZONE = "Europe/Istanbul";

/**
 * Validate an IANA timezone name. Returns the canonical name, `null` when the
 * runtime rejects it, and the default when nothing was supplied.
 */
export function resolveTimeZone(
  tz: string | null | undefined
): string | null {
  const trimmed = tz?.trim();
  if (!trimmed) return DEFAULT_TIME_ZONE;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).resolvedOptions()
      .timeZone;
  } catch {
    return null;
  }
}

export interface LocalParts {
  year: number;
  /** 1–12 */
  month: number;
  /** 0–23 */
  hour: number;
}

// One formatter per zone per process: constructing Intl.DateTimeFormat is
// expensive and the trend endpoint calls this once per post.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      hour: "numeric",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/**
 * Year / month / hour-of-day of `date` as seen in `timeZone`, including DST —
 * which a fixed UTC offset cannot express.
 */
export function localParts(date: Date, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  // Some engines print midnight as "24" even with h23; normalize.
  const rawHour = read("hour");
  return {
    year: read("year"),
    month: read("month"),
    hour: rawHour === 24 ? 0 : rawHour,
  };
}

/** "2026 H1" / "2026 H2" — the period label used by the trend table. */
export function halfYearLabel(parts: LocalParts): string {
  return `${parts.year} ${parts.month <= 6 ? "H1" : "H2"}`;
}

/**
 * Turkish call-to-action wording used in the captions this instance was
 * built for ("yorumlara yaz", "takip et ve …").
 */
export const CTA_PATTERN_TR = /yorumlar|takip et ve/i;
/** English equivalents so non-Turkish accounts get a CTA split too. */
export const CTA_PATTERN_EN = /link in bio|comment|dm me/i;
/** Either language counts as a call to action. */
export const CTA_PATTERN = new RegExp(
  `${CTA_PATTERN_TR.source}|${CTA_PATTERN_EN.source}`,
  "i"
);

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
