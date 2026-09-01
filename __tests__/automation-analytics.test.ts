import { describe, expect, it } from "vitest";
import {
  bucketDaily,
  buildCampaignAnalytics,
  classifyDevice,
  normalizeFailure,
  normalizeReferrer,
  topCounts,
} from "../app/api/automations/[id]/analytics/compute";

const D = (iso: string) => new Date(iso);

describe("bucketDaily", () => {
  it("zero-fills every day and drops rows outside the range", () => {
    const keys = ["2026-08-01", "2026-08-02", "2026-08-03"];
    const rows = bucketDaily(
      keys,
      [D("2026-08-01T10:00:00Z"), D("2026-08-01T23:59:59Z"), D("2026-08-03T00:00:00Z"), D("2026-07-31T23:59:59Z")],
      [D("2026-08-02T05:00:00Z"), D("2026-08-04T00:00:00Z")]
    );
    expect(rows).toEqual([
      { date: "2026-08-01", sent: 2, clicks: 0 },
      { date: "2026-08-02", sent: 0, clicks: 1 },
      { date: "2026-08-03", sent: 1, clicks: 0 },
    ]);
  });
});

describe("normalizeReferrer", () => {
  it("strips www and lowercases; empty is (direct)", () => {
    expect(normalizeReferrer("https://www.Instagram.com/p/abc")).toBe("instagram.com");
    expect(normalizeReferrer("https://l.instagram.com/?u=x")).toBe("l.instagram.com");
    expect(normalizeReferrer(null)).toBe("(direct)");
    expect(normalizeReferrer("   ")).toBe("(direct)");
    expect(normalizeReferrer("android-app://com.instagram.android")).toBe("com.instagram.android");
  });
});

describe("classifyDevice", () => {
  it("separates mobile, desktop and other — both directions", () => {
    expect(classifyDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Instagram 300.0")).toBe("mobile");
    expect(classifyDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari")).toBe("mobile");
    expect(classifyDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120")).toBe("desktop");
    expect(classifyDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari")).toBe("desktop");
    expect(classifyDevice("facebookexternalhit/1.1")).toBe("other");
    expect(classifyDevice("curl/8.0")).toBe("other");
    expect(classifyDevice(null)).toBe("other");
    expect(classifyDevice("")).toBe("other");
  });
});

describe("normalizeFailure", () => {
  it("collapses whitespace and trace ids so repeats group", () => {
    expect(normalizeFailure("  (#10) User   not reachable fbtrace_id: AbC123 ")).toBe(
      "(#10) User not reachable"
    );
    expect(normalizeFailure("(#10) User not reachable fbtrace_id=XyZ")).toBe(
      "(#10) User not reachable"
    );
    expect(normalizeFailure(null)).toBe("Unknown error");
    expect(normalizeFailure("")).toBe("Unknown error");
  });
});

describe("topCounts", () => {
  it("sorts by count desc then key asc and caps at limit", () => {
    expect(topCounts(["b", "a", "b", "c", "a", "d"], 3)).toEqual([
      { key: "a", count: 2 },
      { key: "b", count: 2 },
      { key: "c", count: 1 },
    ]);
  });
});

describe("buildCampaignAnalytics", () => {
  it("computes the funnel with capped CTR and fixed device order", () => {
    const out = buildCampaignAnalytics({
      dayKeys: ["2026-08-01", "2026-08-02"],
      comments: 10,
      sentAt: [D("2026-08-01T01:00:00Z"), D("2026-08-01T02:00:00Z"), D("2026-08-02T03:00:00Z"), D("2026-08-02T04:00:00Z")],
      clicks: [
        { createdAt: D("2026-08-01T05:00:00Z"), referrer: "https://www.instagram.com/", userAgent: "iPhone Instagram" },
        { createdAt: D("2026-08-02T05:00:00Z"), referrer: null, userAgent: "Windows NT 10.0 Chrome" },
        { createdAt: D("2026-08-02T06:00:00Z"), referrer: "https://instagram.com/x", userAgent: "iPhone" },
      ],
      failures: ["(#10) blocked", "(#10) blocked", "token expired", null],
    });

    expect(out.funnel).toEqual({ comments: 10, dmsSent: 4, clicks: 3, ctr: 75 });
    expect(out.daily).toEqual([
      { date: "2026-08-01", sent: 2, clicks: 1 },
      { date: "2026-08-02", sent: 2, clicks: 2 },
    ]);
    expect(out.referrers).toEqual([
      { referrer: "instagram.com", count: 2 },
      { referrer: "(direct)", count: 1 },
    ]);
    expect(out.devices).toEqual([
      { kind: "mobile", count: 2 },
      { kind: "desktop", count: 1 },
      { kind: "other", count: 0 },
    ]);
    expect(out.failures).toEqual([
      { reason: "(#10) blocked", count: 2 },
      // ties break alphabetically (localeCompare, case-insensitive): t < u
      { reason: "token expired", count: 1 },
      { reason: "Unknown error", count: 1 },
    ]);
  });

  it("empty inputs give zeros, not NaN", () => {
    const out = buildCampaignAnalytics({ dayKeys: ["2026-08-01"], comments: 0, sentAt: [], clicks: [], failures: [] });
    expect(out.funnel).toEqual({ comments: 0, dmsSent: 0, clicks: 0, ctr: 0 });
    expect(out.daily).toEqual([{ date: "2026-08-01", sent: 0, clicks: 0 }]);
    expect(out.referrers).toEqual([]);
    expect(out.devices.every((d) => d.count === 0)).toBe(true);
  });
});
