import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import {
  getAllUserMedia,
  getMediaInsights,
  type InstagramMedia,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import {
  CTA_PATTERN,
  halfYearLabel,
  localParts,
  median,
  resolveTimeZone,
} from "@/lib/reports/trend-helpers";

// Paginated media + per-post insights on a full account takes a while.
export const maxDuration = 60;

const MAX_POSTS = 500;
const INSIGHTS_CONCURRENCY = 8;
/**
 * A bucket below this many posts is dropped: a median over two or three posts
 * moves with a single outlier and would read as a finding when it is noise.
 */
const MIN_BUCKET = 5;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

interface Post {
  id: string;
  caption: string | null;
  permalink: string | null;
  timestamp: string;
  likes: number;
  comments: number;
  engagement: number;
  views: number | null;
  saved: number | null;
  shares: number | null;
  localHour: number;
  half: string;
  captionLength: number;
  hasCta: boolean;
  /** Days since the previously published post; null for the oldest one. */
  gapDays: number | null;
}

/** A generic "bucket of posts" row — same shape for cadence, length, CTA. */
export interface TrendBucket {
  label: string;
  posts: number;
  medianViews: number | null;
  medianEngagement: number;
}

export interface TrendCta extends TrendBucket {
  medianComments: number;
  medianLikes: number;
  /** Comments as a percentage of likes — how strongly a post pulls replies. */
  commentPerLikePct: number;
}

export interface TrendRecent {
  posts: number;
  medianViews: number | null;
  medianEngagement: number;
  bestViews: number | null;
}

export interface TrendPeriod {
  label: string;
  posts: number;
  medianViews: number | null;
  medianEngagement: number;
  engagementRate: number | null;
  medianSaved: number | null;
}

export interface TrendHour {
  label: string;
  posts: number;
  medianEngagement: number;
  medianViews: number | null;
}

export interface TrendResponse {
  account: { id: string; username: string };
  accounts: Array<{ id: string; username: string }>;
  /** IANA zone the hour-of-day buckets were computed in. */
  timeZone: string;
  totalPosts: number;
  withInsights: number;
  firstPost: string | null;
  lastPost: string | null;
  periods: TrendPeriod[];
  hours: TrendHour[];
  /** Views collapsed while engagement-per-view held: a distribution problem. */
  reachCollapsed: boolean;
  /** Posting frequency: does spacing posts out change reach? */
  cadence: TrendBucket[];
  captionLength: TrendBucket[];
  cta: TrendCta[];
  last30: TrendRecent | null;
  /**
   * Dimensions that could not be measured because every post shares the same
   * value — reported instead of silently omitted, so an untested factor is
   * never mistaken for a tested one.
   */
  unmeasured: string[];
  topPosts: {
    permalink: string | null;
    caption: string | null;
    timestamp: string;
    engagement: number;
    views: number | null;
  }[];
}

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  // Publishing hour only means something in the author's own zone. The page
  // sends the browser's zone; a bare API call falls back to the default.
  const timeZone = resolveTimeZone(request.nextUrl.searchParams.get("tz"));
  if (!timeZone) {
    return NextResponse.json(
      { success: false, error: "Invalid tz — expected an IANA timezone name" },
      { status: 400 }
    );
  }

  const account = await getWorkspaceInstagramAccount(
    workspaceId,
    request.nextUrl.searchParams.get("instagramAccountId")
  );
  if (!account) {
    return NextResponse.json(
      { success: false, error: "No Instagram account connected" },
      { status: 404 }
    );
  }

  const token = decryptToken(account.accessToken);
  let media: InstagramMedia[] = [];
  try {
    media = await getAllUserMedia(token, MAX_POSTS);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Media fetch failed",
      },
      { status: 502 }
    );
  }

  // Insights fail on posts published before the account became a business
  // account. Those are skipped, not treated as zero — a zero would drag the
  // medians down and invent a decline that isn't there.
  const enriched = await mapWithConcurrency(
    media,
    INSIGHTS_CONCURRENCY,
    async (m): Promise<Post> => {
      let views: number | null = null;
      let saved: number | null = null;
      let shares: number | null = null;
      try {
        const ins = await getMediaInsights(token, m.id, [
          "views",
          "saved",
          "shares",
        ]);
        views = ins.views ?? null;
        saved = ins.saved ?? null;
        shares = ins.shares ?? null;
      } catch {
        // older-than-business-account post; leave nulls
      }
      const local = localParts(new Date(m.timestamp), timeZone);
      const caption = m.caption ?? null;
      return {
        id: m.id,
        caption,
        permalink: m.permalink ?? null,
        timestamp: m.timestamp,
        likes: m.like_count ?? 0,
        comments: m.comments_count ?? 0,
        engagement: (m.like_count ?? 0) + (m.comments_count ?? 0),
        views,
        saved,
        shares,
        localHour: local.hour,
        half: halfYearLabel(local),
        captionLength: caption?.length ?? 0,
        hasCta: CTA_PATTERN.test(caption ?? ""),
        gapDays: null,
      };
    }
  );

  // Gap to the previous post, in publication order. Filled after the fetch
  // because the API returns newest-first and concurrency scrambles arrival.
  const chronological = [...enriched].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp)
  );
  for (let i = 1; i < chronological.length; i++) {
    const prev = new Date(chronological[i - 1].timestamp).getTime();
    const cur = new Date(chronological[i].timestamp).getTime();
    chronological[i].gapDays = (cur - prev) / 86_400_000;
  }

  const byHalf = new Map<string, Post[]>();
  for (const p of enriched) {
    const list = byHalf.get(p.half) ?? [];
    list.push(p);
    byHalf.set(p.half, list);
  }

  const periods: TrendPeriod[] = [...byHalf.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, group]) => {
      const withViews = group.filter((p) => p.views && p.views > 0);
      return {
        label,
        posts: group.length,
        medianViews: withViews.length ? median(withViews.map((p) => p.views!)) : null,
        medianEngagement: median(group.map((p) => p.engagement)),
        engagementRate: withViews.length
          ? Number(
              (
                median(
                  withViews.map((p) => (100 * p.engagement) / p.views!)
                ) as number
              ).toFixed(2)
            )
          : null,
        medianSaved: withViews.length
          ? median(withViews.filter((p) => p.saved != null).map((p) => p.saved!))
          : null,
      };
    });

  const HOUR_BUCKETS: [string, number, number][] = [
    ["00:00–09:00", 0, 9],
    ["09:00–15:00", 9, 15],
    ["15:00–18:00", 15, 18],
    ["18:00–21:00", 18, 21],
    ["21:00–24:00", 21, 24],
  ];
  const hours: TrendHour[] = HOUR_BUCKETS.map(([label, from, to]) => {
    const group = enriched.filter(
      (p) => p.localHour >= from && p.localHour < to
    );
    const withViews = group.filter((p) => p.views && p.views > 0);
    return {
      label,
      posts: group.length,
      medianEngagement: median(group.map((p) => p.engagement)),
      medianViews: withViews.length ? median(withViews.map((p) => p.views!)) : null,
    };
  }).filter((h) => h.posts > 0);

  // Reach collapse test: views down heavily while engagement-per-view held.
  // That separates "the algorithm stopped showing it" from "people stopped
  // liking it" — opposite diagnoses, opposite fixes.
  const withRate = periods.filter((p) => p.medianViews && p.engagementRate);
  const reachCollapsed =
    withRate.length >= 2 &&
    withRate[0].medianViews! > 0 &&
    withRate[withRate.length - 1].medianViews! / withRate[0].medianViews! < 0.5 &&
    withRate[withRate.length - 1].engagementRate! >=
      withRate[0].engagementRate! * 0.8;

  function bucket(label: string, group: Post[]): TrendBucket {
    const withViews = group.filter((p) => p.views && p.views > 0);
    return {
      label,
      posts: group.length,
      medianViews: withViews.length
        ? median(withViews.map((p) => p.views!))
        : null,
      medianEngagement: median(group.map((p) => p.engagement)),
    };
  }

  const withGap = enriched.filter((p) => p.gapDays !== null);
  const cadence = [
    bucket(
      "Aynı gün",
      withGap.filter((p) => p.gapDays! < 1)
    ),
    bucket(
      "1–3 gün ara",
      withGap.filter((p) => p.gapDays! >= 1 && p.gapDays! < 3)
    ),
    bucket(
      "3+ gün ara",
      withGap.filter((p) => p.gapDays! >= 3)
    ),
  ].filter((b) => b.posts >= MIN_BUCKET);

  const captionLength = [
    bucket(
      "0–300 karakter",
      enriched.filter((p) => p.captionLength < 300)
    ),
    bucket(
      "300–600 karakter",
      enriched.filter((p) => p.captionLength >= 300 && p.captionLength < 600)
    ),
    bucket(
      "600+ karakter",
      enriched.filter((p) => p.captionLength >= 600)
    ),
  ].filter((b) => b.posts >= MIN_BUCKET);

  // CTA is judged on comments-per-like, not on views: the point of asking for
  // a comment is to get comments, and views are set by distribution upstream
  // of anything the caption says.
  const cta: TrendCta[] = [
    ["Çağrı var", enriched.filter((p) => p.hasCta)] as const,
    ["Çağrı yok", enriched.filter((p) => !p.hasCta)] as const,
  ]
    .map(([label, group]) => {
      const medianLikes = median(group.map((p) => p.likes));
      const medianComments = median(group.map((p) => p.comments));
      return {
        ...bucket(label, group),
        medianLikes,
        medianComments,
        commentPerLikePct: medianLikes
          ? Number(((100 * medianComments) / medianLikes).toFixed(1))
          : 0,
      };
    })
    .filter((b) => b.posts >= MIN_BUCKET);

  const cutoff = Date.now() - 30 * 86_400_000;
  const recentPosts = enriched.filter(
    (p) => new Date(p.timestamp).getTime() >= cutoff
  );
  const recentViews = recentPosts
    .filter((p) => p.views && p.views > 0)
    .map((p) => p.views!);
  const last30: TrendRecent | null = recentPosts.length
    ? {
        posts: recentPosts.length,
        medianViews: recentViews.length ? median(recentViews) : null,
        medianEngagement: median(recentPosts.map((p) => p.engagement)),
        bestViews: recentViews.length ? Math.max(...recentViews) : null,
      }
    : null;

  // A dimension with no contrast cannot be tested. Saying so beats leaving it
  // out, which would read as "checked and found nothing".
  const unmeasured: string[] = [];
  const hashtagCounts = enriched.map(
    (p) => (p.caption?.match(/#\w+/g) ?? []).length
  );
  const fewHashtags = hashtagCounts.filter((n) => n <= 3).length;
  if (hashtagCounts.length && fewHashtags < MIN_BUCKET) {
    unmeasured.push(
      `Hashtag sayısı: ${hashtagCounts.length} içeriğin ${
        hashtagCounts.length - fewHashtags
      } tanesinde 4+ hashtag var. Karşılaştıracak az-hashtag'li grup olmadığı için etkisi ölçülemedi.`
    );
  }
  if (cta.length < 2) {
    unmeasured.push(
      "Yorum çağrısı: iki gruptan biri karşılaştırma için fazla küçük, etkisi ölçülemedi."
    );
  }

  const sorted = [...enriched].sort((a, b) => b.engagement - a.engagement);

  const accounts = await prisma.instagramAccount.findMany({
    where: { workspaceId },
    orderBy: { connectedAt: "desc" },
    select: { id: true, username: true },
  });

  const body: TrendResponse = {
    account: { id: account.id, username: account.username },
    accounts,
    timeZone,
    totalPosts: enriched.length,
    withInsights: enriched.filter((p) => p.views != null).length,
    firstPost: enriched.length
      ? enriched.reduce((a, b) => (a.timestamp < b.timestamp ? a : b)).timestamp
      : null,
    lastPost: enriched.length
      ? enriched.reduce((a, b) => (a.timestamp > b.timestamp ? a : b)).timestamp
      : null,
    periods,
    hours,
    reachCollapsed,
    cadence,
    captionLength,
    cta,
    last30,
    unmeasured,
    topPosts: sorted.slice(0, 8).map((p) => ({
      permalink: p.permalink,
      caption: p.caption,
      timestamp: p.timestamp,
      engagement: p.engagement,
      views: p.views,
    })),
  };

  return NextResponse.json({ success: true, data: body });
}
