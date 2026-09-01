/**
 * Pure aggregation for the campaign Insights tab. The route fetches raw rows
 * (timestamps, referrers, user agents, error messages) and this turns them
 * into the funnel / daily series / breakdowns. No Prisma here so it can be
 * unit-tested with plain arrays.
 */
import { calculateCtr } from "@/lib/tracking/analytics";

export type DeviceKind = "mobile" | "desktop" | "other";

export interface AnalyticsInputs {
  /** Every day in the range, YYYY-MM-DD, in order (see `dayKeys`). */
  dayKeys: string[];
  /** Matched comments in range (every DmLog row is one matched comment). */
  comments: number;
  /** createdAt of each SENT DmLog in range. */
  sentAt: Date[];
  /** One entry per LinkClick in range. */
  clicks: { createdAt: Date; referrer: string | null; userAgent: string | null }[];
  /** errorMessage of each FAILED DmLog in range. */
  failures: (string | null)[];
}

export interface CampaignAnalytics {
  funnel: { comments: number; dmsSent: number; clicks: number; ctr: number };
  daily: { date: string; sent: number; clicks: number }[];
  referrers: { referrer: string; count: number }[];
  devices: { kind: DeviceKind; count: number }[];
  failures: { reason: string; count: number }[];
}

export const TOP_REFERRERS = 8;
export const TOP_FAILURES = 5;

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Zero-filled per-day counts; rows outside `dayKeys` are dropped. */
export function bucketDaily(
  dayKeys: string[],
  sentAt: Date[],
  clickAt: Date[]
): CampaignAnalytics["daily"] {
  const index = new Map(dayKeys.map((k, i) => [k, i] as const));
  const rows = dayKeys.map((date) => ({ date, sent: 0, clicks: 0 }));
  for (const d of sentAt) {
    const i = index.get(dayKey(d));
    if (i !== undefined) rows[i].sent += 1;
  }
  for (const d of clickAt) {
    const i = index.get(dayKey(d));
    if (i !== undefined) rows[i].clicks += 1;
  }
  return rows;
}

/** Hostname without "www."; empty/invalid → "(direct)". */
export function normalizeReferrer(referrer: string | null | undefined): string {
  const value = (referrer ?? "").trim();
  if (!value) return "(direct)";
  try {
    const host = new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
    return host || "(direct)";
  } catch {
    // Not a URL (e.g. "android-app://com.instagram.android" parses, but a
    // bare token does not) — keep the raw token so it still groups.
    return value.slice(0, 80).toLowerCase();
  }
}

const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegrambot|twitterbot|linkedinbot|slackbot|discordbot|preview|headless|curl\/|wget\//i;
const MOBILE_RE = /mobile|android|iphone|ipad|ipod|instagram|fban|fbav|fb_iab|windows phone|opera mini|iemobile/i;
const DESKTOP_RE = /windows nt|macintosh|mac os x|x11|linux|cros/i;

/** Coarse device class from a user agent. Bots and unknowns are "other". */
export function classifyDevice(userAgent: string | null | undefined): DeviceKind {
  const ua = (userAgent ?? "").trim();
  if (!ua) return "other";
  if (BOT_RE.test(ua)) return "other";
  if (MOBILE_RE.test(ua)) return "mobile";
  if (DESKTOP_RE.test(ua)) return "desktop";
  return "other";
}

/**
 * Collapse near-identical error strings: trim, squash whitespace, strip the
 * Meta trace id / request id noise so the same failure counts once.
 */
export function normalizeFailure(message: string | null | undefined): string {
  const raw = (message ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "Unknown error";
  return raw
    .replace(/\b(fbtrace_id|trace id|request id)[:=]?\s*[\w-]+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/** Count occurrences, sorted by count desc then key asc, top `limit`. */
export function topCounts<T extends string>(
  values: T[],
  limit: number
): { key: T; count: number }[] {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return Array.from(counts, ([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

export function buildCampaignAnalytics(input: AnalyticsInputs): CampaignAnalytics {
  const dmsSent = input.sentAt.length;
  const clicks = input.clicks.length;

  const deviceCounts = topCounts(
    input.clicks.map((c) => classifyDevice(c.userAgent)),
    3
  );
  // Always list all three kinds in a fixed order so the table is stable.
  const devices = (["mobile", "desktop", "other"] as const).map((kind) => ({
    kind,
    count: deviceCounts.find((d) => d.key === kind)?.count ?? 0,
  }));

  return {
    funnel: {
      comments: input.comments,
      dmsSent,
      clicks,
      ctr: calculateCtr(clicks, dmsSent),
    },
    daily: bucketDaily(
      input.dayKeys,
      input.sentAt,
      input.clicks.map((c) => c.createdAt)
    ),
    referrers: topCounts(
      input.clicks.map((c) => normalizeReferrer(c.referrer)),
      TOP_REFERRERS
    ).map((r) => ({ referrer: r.key, count: r.count })),
    devices,
    failures: topCounts(input.failures.map(normalizeFailure), TOP_FAILURES).map(
      (f) => ({ reason: f.key, count: f.count })
    ),
  };
}
