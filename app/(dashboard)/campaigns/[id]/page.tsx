"use client";

/**
 * Campaign Detail
 *
 * Read-only view of one campaign: a summary of the automation on the left,
 * Insights / Preview tabs on the right. Edit and Stop/Resume live in the top
 * bar; report sharing is toggled from the summary column.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import CampaignPreview, { type PreviewTab } from "@/components/campaign-preview";
import DateRangePicker, {
  rangeForDays,
  rangeToParams,
  type DateRange,
} from "@/components/date-range-picker";
import StatCard from "@/components/stat-card";
import StatusBadge from "@/components/status-badge";
import { useToast } from "@/components/toast";
import { IconAlert, IconRefresh } from "@/components/icons";

interface Campaign {
  id: string;
  name: string;
  goal: string | null;
  postId: string | null;
  postUrl: string | null;
  pendingNextReel: boolean;
  matchAnyPost: boolean;
  keywords: string[];
  matchAnyWord: boolean;
  wholeWordMatch: boolean;
  dmTriggerEnabled: boolean;
  dmMessage: string;
  openingDmEnabled: boolean;
  openingDmMessage: string | null;
  openingDmButtonLabel: string | null;
  linkButtonLabel: string | null;
  requireFollow: boolean;
  followPromptMessage: string | null;
  followPromptButtonLabel: string | null;
  followUpEnabled: boolean;
  followUpMessage: string | null;
  followUpDelayMinutes: number | null;
  publicReplyEnabled: boolean;
  publicReplyMessage: string | null;
  publicReplyMessages: string[];
  isActive: boolean;
  reportShareEnabled: boolean;
  reportShareSlug: string | null;
  reportUrl: string | null;
  instagramAccountId: string;
  instagramAccount: { username: string };
  trackedLinks?: {
    destinationUrl: string;
    label?: string | null;
    trackedUrl?: string;
  }[];
  analytics: {
    sent: number;
    skipped: number;
    failed: number;
    clicks: number;
    ctr: number;
  };
}

interface CampaignAnalytics {
  range: { from: string; to: string };
  funnel: { comments: number; dmsSent: number; clicks: number; ctr: number };
  daily: { date: string; sent: number; clicks: number }[];
  referrers: { referrer: string; count: number }[];
  devices: { kind: "mobile" | "desktop" | "other"; count: number }[];
  failures: { reason: string; count: number }[];
}

type Tab = "insights" | "preview";

async function apiCall<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  let payload: { success?: boolean; error?: string; data?: T } = {};
  try {
    payload = await res.json();
  } catch {
    // Non-JSON body — the status-based error below covers it.
  }
  if (!res.ok || !payload.success) {
    throw new Error(payload.error ?? `Request failed (${res.status})`);
  }
  return payload.data as T;
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

export default function CampaignDetailPage() {
  const router = useRouter();
  const toast = useToast();
  const { id } = useParams<{ id: string }>();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [postThumb, setPostThumb] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("insights");
  const [previewTab, setPreviewTab] = useState<PreviewTab>("dm");
  const [busy, setBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setNotFound(false);
    try {
      const list = await apiCall<Campaign[]>(
        `/api/automations?id=${encodeURIComponent(id)}`,
        { cache: "no-store" }
      );
      const found = list.find((c) => c.id === id);
      if (!found) {
        setNotFound(true);
        return;
      }
      setCampaign(found);
    } catch (err) {
      const message = errorMessage(err, "Failed to load campaign");
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!campaign) return;
    const acct = campaign.instagramAccountId;
    fetch(`/api/instagram/profile?instagramAccountId=${acct}`)
      .then((r) => r.json())
      .then((d) =>
        setAvatarUrl(d.success ? d.data.profilePictureUrl ?? null : null)
      )
      .catch(() => setAvatarUrl(null));

    if (campaign.postId) {
      fetch(`/api/instagram/posts?instagramAccountId=${acct}&limit=50`)
        .then((r) => r.json())
        .then((payload) => {
          if (!payload.success) return;
          const hit = (
            payload.data as {
              id: string;
              thumbnail_url?: string;
              media_url?: string;
            }[]
          ).find((p) => p.id === campaign.postId);
          setPostThumb(hit?.thumbnail_url ?? hit?.media_url ?? null);
        })
        .catch(() => setPostThumb(null));
    }
  }, [campaign]);

  async function toggleActive() {
    if (!campaign) return;
    const next = !campaign.isActive;
    setBusy(true);
    try {
      await apiCall(`/api/automations?id=${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      setCampaign({ ...campaign, isActive: next });
      toast.success(next ? "Campaign resumed" : "Campaign paused");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to update campaign"));
    } finally {
      setBusy(false);
    }
  }

  async function toggleShare() {
    if (!campaign) return;
    const enabled = !campaign.reportShareEnabled;
    setShareBusy(true);
    try {
      const data = await apiCall<{
        reportShareEnabled: boolean;
        reportShareSlug: string | null;
        reportUrl: string | null;
      }>(`/api/automations/${campaign.id}/share`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      setCampaign({ ...campaign, ...data });
      toast.success(
        enabled ? "Report sharing turned on" : "Report sharing turned off"
      );
    } catch (err) {
      toast.error(errorMessage(err, "Failed to update report sharing"));
    } finally {
      setShareBusy(false);
    }
  }

  async function copyReportUrl() {
    if (!campaign?.reportUrl) return;
    try {
      await navigator.clipboard.writeText(campaign.reportUrl);
      toast.success("Report link copied");
    } catch {
      toast.error("Could not copy the report link");
    }
  }

  if (loading) {
    return (
      <div
        className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]"
        aria-busy="true"
        aria-label="Loading campaign"
      >
        <div className="panel h-96 animate-pulse" />
        <div className="panel h-64 animate-pulse" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="panel p-8 text-center" role="alert">
        <IconAlert className="mx-auto text-error" size={24} />
        <h2 className="mt-3 text-base font-semibold">Couldn&rsquo;t load campaign</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{error}</p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void load();
            }}
            className="btn btn-secondary"
          >
            <IconRefresh size={16} /> Retry
          </button>
          <Link href="/campaigns" className="btn btn-ghost">
            Back to campaigns
          </Link>
        </div>
      </div>
    );
  }
  if (notFound || !campaign) {
    return (
      <div className="panel p-8 text-center">
        <p className="text-sm text-muted">Campaign not found.</p>
        <button
          type="button"
          onClick={() => router.push("/campaigns")}
          className="btn btn-secondary mt-4"
        >
          Back to campaigns
        </button>
      </div>
    );
  }

  const publicReplies =
    campaign.publicReplyMessages && campaign.publicReplyMessages.length > 0
      ? campaign.publicReplyMessages
      : campaign.publicReplyMessage
        ? [campaign.publicReplyMessage]
        : [];
  const hasLink = Boolean(campaign.trackedLinks?.[0]?.destinationUrl);
  const hasSecondLink = Boolean(campaign.trackedLinks?.[1]?.destinationUrl);

  const trigger = campaign.matchAnyPost
    ? "Any post or reel"
    : campaign.pendingNextReel
      ? "Your next reel"
      : "A specific post or reel";
  const matchText = campaign.matchAnyWord
    ? "Any comment"
    : campaign.keywords.join(", ") || "No keywords";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
      {/* Left: config summary */}
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Link href="/campaigns" className="text-sm text-muted hover:text-foreground">
            &larr; Campaigns
          </Link>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold">{campaign.name}</h1>
            <StatusBadge status={campaign.isActive ? "ACTIVE" : "PAUSED"} />
          </div>
          {campaign.goal && (
            <p className="text-sm text-muted">Goal: {campaign.goal}</p>
          )}
        </div>

        {/* Report sharing */}
        <div className="panel space-y-3 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p id="share-report-label" className="text-sm font-medium text-foreground">
                Share report
              </p>
              <p className="text-xs text-muted">
                Public, read-only results page for this campaign.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={campaign.reportShareEnabled}
              aria-labelledby="share-report-label"
              disabled={shareBusy}
              onClick={() => void toggleShare()}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                campaign.reportShareEnabled ? "bg-accent" : "bg-border-hover"
              }`}
            >
              <span
                className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                  campaign.reportShareEnabled ? "left-6" : "left-1"
                }`}
              />
            </button>
          </div>
          {campaign.reportShareEnabled && campaign.reportUrl && (
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={campaign.reportUrl}
                aria-label="Public report URL"
                onFocus={(e) => e.currentTarget.select()}
                className="input input-sm min-w-0 flex-1 font-mono"
              />
              <button
                type="button"
                onClick={() => void copyReportUrl()}
                className="btn btn-secondary btn-sm shrink-0"
              >
                Copy
              </button>
              <a
                href={campaign.reportUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost btn-sm shrink-0"
              >
                Open
              </a>
            </div>
          )}
        </div>

        <CollectedEmailsCard campaignId={campaign.id} />

        <Summary title="When someone comments on">
          <div className="flex items-center gap-3">
            {postThumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={postThumb} alt="Post" className="h-14 w-14 rounded object-cover" />
            ) : (
              <div className="grid h-14 w-14 place-items-center rounded bg-surface-hover text-xs text-muted">
                {campaign.matchAnyPost || campaign.pendingNextReel ? "Any" : "Post"}
              </div>
            )}
            <span className="text-sm text-foreground">{trigger}</span>
          </div>
        </Summary>

        <Summary title="And this comment has">
          <FieldBox>{matchText}</FieldBox>
          {!campaign.matchAnyWord && (
            <p className="text-xs text-muted">
              {campaign.wholeWordMatch
                ? "Keywords match whole words only."
                : "Keywords match anywhere in the comment."}
            </p>
          )}
          {campaign.dmTriggerEnabled && (
            <p className="text-xs text-muted">
              Also replies when someone DMs{" "}
              {campaign.matchAnyWord ? "anything" : "these words"}.
            </p>
          )}
          {publicReplies.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted">Public reply under the post</p>
              {publicReplies.map((m, i) => (
                <FieldBox key={i}>{m}</FieldBox>
              ))}
            </div>
          )}
        </Summary>

        {campaign.openingDmEnabled && (
          <Summary title="They will get an opening DM">
            <FieldBox>{campaign.openingDmMessage || "Opening message"}</FieldBox>
            <FieldBox>{campaign.openingDmButtonLabel || "Button"}</FieldBox>
          </Summary>
        )}

        {campaign.requireFollow && (
          <Summary title="They must follow first">
            <FieldBox>
              {campaign.followPromptMessage ||
                "quick favor before i send your link. i don't make any money from this, it's free. if you want to support me, just don't unfollow after, and star the repo on github if it helps you. tap the button once you're following and i'll send it over"}
            </FieldBox>
            <FieldBox>{campaign.followPromptButtonLabel || "i'm following"}</FieldBox>
          </Summary>
        )}

        <Summary title="And then, they will get a DM">
          <FieldBox>{campaign.dmMessage}</FieldBox>
          {hasLink && <FieldBox>{campaign.linkButtonLabel || "Open link"}</FieldBox>}
          {hasSecondLink && (
            <FieldBox>{campaign.trackedLinks?.[1]?.label || "Open link"}</FieldBox>
          )}
        </Summary>

        {hasLink && (
          <Summary title="The exact link sent">
            {campaign.trackedLinks
              ?.filter((link) => link.destinationUrl)
              .map((link, i) => (
                <div key={i} className="space-y-1">
                  <div className="rounded border border-border bg-surface px-3 py-2">
                    <p className="select-all break-all font-mono text-xs text-foreground">
                      {link.trackedUrl ?? link.destinationUrl}
                    </p>
                  </div>
                  <p className="text-xs text-muted">
                    {link.label ? `${link.label} · ` : ""}redirects to{" "}
                    <span className="break-all">{link.destinationUrl}</span>
                  </p>
                </div>
              ))}
          </Summary>
        )}

        {campaign.followUpEnabled && campaign.followUpMessage && (
          <Summary title="Then a follow-up message">
            <FieldBox>{campaign.followUpMessage}</FieldBox>
            <p className="text-xs text-muted">
              {campaign.followUpDelayMinutes && campaign.followUpDelayMinutes > 0
                ? `Sent ${campaign.followUpDelayMinutes} min after the link.`
                : "Sent right after the link."}
            </p>
          </Summary>
        )}
      </div>

      {/* Right: top bar + tabs */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-3 border-b border-border pb-3">
          <div role="tablist" aria-label="Campaign views" className="flex gap-4">
            <TabButton
              id="tab-insights"
              active={tab === "insights"}
              onClick={() => setTab("insights")}
            >
              Insights
            </TabButton>
            <TabButton
              id="tab-preview"
              active={tab === "preview"}
              onClick={() => setTab("preview")}
            >
              Preview
            </TabButton>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/campaigns/${campaign.id}/edit`} className="btn btn-secondary">
              Edit
            </Link>
            <button
              type="button"
              onClick={() => void toggleActive()}
              disabled={busy}
              className={`btn ${campaign.isActive ? "btn-danger" : "btn-primary"}`}
            >
              {campaign.isActive ? "Stop" : "Resume"}
            </button>
          </div>
        </div>

        {tab === "insights" && (
          <div role="tabpanel" aria-labelledby="tab-insights">
            <InsightsPanel campaignId={campaign.id} />
          </div>
        )}

        {tab === "preview" && (
          <div
            role="tabpanel"
            aria-labelledby="tab-preview"
            className="flex justify-center sm:justify-start"
          >
            <CampaignPreview
              tab={previewTab}
              onTabChange={setPreviewTab}
              username={campaign.instagramAccount.username}
              avatarUrl={avatarUrl}
              postThumb={postThumb}
              caption=""
              sampleComment={
                campaign.matchAnyWord ? "nice!" : campaign.keywords[0] ?? "LINK"
              }
              dmTriggerEnabled={campaign.dmTriggerEnabled}
              publicReplyEnabled={campaign.publicReplyEnabled}
              publicReplyMessage={publicReplies[0] ?? ""}
              openingDmEnabled={campaign.openingDmEnabled}
              openingDmMessage={campaign.openingDmMessage ?? ""}
              openingDmButtonLabel={campaign.openingDmButtonLabel ?? ""}
              revealMessage={campaign.dmMessage}
              hasLink={hasLink}
              linkButtonLabel={campaign.linkButtonLabel ?? "Open link"}
              linkUrl={
                campaign.trackedLinks?.[0]?.trackedUrl ??
                campaign.trackedLinks?.[0]?.destinationUrl
              }
              hasSecondLink={hasSecondLink}
              secondLinkButtonLabel={campaign.trackedLinks?.[1]?.label ?? "Open link"}
              requireFollow={campaign.requireFollow}
              followPromptMessage={campaign.followPromptMessage ?? ""}
              followPromptButtonLabel={campaign.followPromptButtonLabel ?? "i'm following"}
              followUpEnabled={campaign.followUpEnabled ?? false}
              followUpMessage={campaign.followUpMessage ?? ""}
              followUpDelayMinutes={campaign.followUpDelayMinutes ?? 0}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- Insights ------------------------------- */

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: CampaignAnalytics["daily"][number] }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="text-muted">{formatDay(point.date)}</p>
      <p className="mt-1 font-semibold text-foreground">{point.sent} DMs sent</p>
      <p className="text-foreground">{point.clicks} clicks</p>
    </div>
  );
}

function InsightsPanel({ campaignId }: { campaignId: string }) {
  const toast = useToast();
  const [range, setRange] = useState<DateRange>(() => rangeForDays(30));
  const [data, setData] = useState<CampaignAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = rangeToParams(range);
      const result = await apiCall<CampaignAnalytics>(
        `/api/automations/${campaignId}/analytics?${params}`,
        { cache: "no-store" }
      );
      setData(result);
    } catch (err) {
      const message = errorMessage(err, "Failed to load insights");
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [campaignId, range, toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const isEmpty =
    data !== null &&
    data.funnel.comments === 0 &&
    data.funnel.dmsSent === 0 &&
    data.funnel.clicks === 0;

  return (
    <div className="space-y-4">
      <DateRangePicker value={range} onChange={setRange} />

      {loading && (
        <div className="space-y-4" aria-busy="true" aria-label="Loading insights">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="panel h-20 animate-pulse" />
            ))}
          </div>
          <div className="panel h-64 animate-pulse" />
        </div>
      )}

      {!loading && error && (
        <div className="panel p-6 text-center" role="alert">
          <IconAlert className="mx-auto text-error" size={22} />
          <p className="mt-2 text-sm text-foreground">Couldn&rsquo;t load insights</p>
          <p className="mt-1 text-sm text-muted">{error}</p>
          <button type="button" onClick={() => void load()} className="btn btn-secondary mt-4">
            <IconRefresh size={16} /> Retry
          </button>
        </div>
      )}

      {!loading && !error && data && isEmpty && (
        <div className="panel p-8 text-center">
          <p className="text-sm font-medium text-foreground">
            No activity between {formatDay(data.range.from)} and{" "}
            {formatDay(data.range.to)}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            Nothing matched this campaign in that window. Try a wider range, or
            check the campaign is live and the post is getting comments.
          </p>
          <button
            type="button"
            onClick={() => setRange(rangeForDays(90))}
            className="btn btn-secondary mt-4"
          >
            Show last 90 days
          </button>
        </div>
      )}

      {!loading && !error && data && !isEmpty && (
        <>
          {/* Funnel */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Comments matched" value={data.funnel.comments} />
            <StatCard
              label="DMs sent"
              value={data.funnel.dmsSent}
              hint={
                data.funnel.comments > 0
                  ? `${Math.round((data.funnel.dmsSent / data.funnel.comments) * 100)}% of comments`
                  : undefined
              }
            />
            <StatCard label="Link clicks" value={data.funnel.clicks} />
            <StatCard
              label="CTR"
              value={`${data.funnel.ctr}%`}
              hint={`${data.funnel.clicks} clicks / ${data.funnel.dmsSent} sent`}
            />
          </div>

          {/* Daily sent vs clicks */}
          <div className="panel p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">
                DMs sent vs. clicks per day
              </h2>
              <div className="flex items-center gap-4 text-xs text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden="true" />
                  DMs sent
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-info" aria-hidden="true" />
                  Clicks
                </span>
              </div>
            </div>
            <div className="mt-4 h-56 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={data.daily}
                  margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
                >
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDay}
                    tick={{ fill: "var(--muted)", fontSize: 12 }}
                    stroke="var(--border)"
                    tickLine={false}
                    minTickGap={24}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: "var(--muted)", fontSize: 12 }}
                    stroke="var(--border)"
                    tickLine={false}
                    width={36}
                  />
                  <Tooltip
                    content={<ChartTooltip />}
                    cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="sent"
                    name="DMs sent"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: "var(--accent)", stroke: "var(--bg)", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="clicks"
                    name="Clicks"
                    stroke="var(--info)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: "var(--info)", stroke: "var(--bg)", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Breakdowns */}
          <div className="grid gap-4 lg:grid-cols-3">
            <BreakdownTable
              title="Top referrers"
              caption="Where link clicks came from"
              header="Referrer"
              rows={data.referrers.map((r) => ({ label: r.referrer, count: r.count }))}
              empty="No clicks in this range."
            />
            <BreakdownTable
              title="Devices"
              caption="Device class of link clicks, from the user agent"
              header="Device"
              rows={data.devices.map((d) => ({
                label: d.kind === "other" ? "Other / bots" : d.kind,
                count: d.count,
              }))}
              empty="No clicks in this range."
              capitalize
            />
            <BreakdownTable
              title="Top failure reasons"
              caption="Why DMs failed to send"
              header="Reason"
              rows={data.failures.map((f) => ({ label: f.reason, count: f.count }))}
              empty="No failed DMs in this range."
            />
          </div>
        </>
      )}
    </div>
  );
}

function BreakdownTable({
  title,
  caption,
  header,
  rows,
  empty,
  capitalize,
}: {
  title: string;
  caption: string;
  header: string;
  rows: { label: string; count: number }[];
  empty: string;
  capitalize?: boolean;
}) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {total === 0 ? (
        <div className="panel p-4 text-sm text-muted">{empty}</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                <th scope="col">{header}</th>
                <th scope="col" className="num text-right">
                  Count
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td className={`break-all ${capitalize ? "capitalize" : ""}`}>
                    {r.label}
                  </td>
                  <td className="num text-right tabular-nums">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* --------------------------- collected emails ---------------------------- */

interface LeadPreview {
  id: string;
  email: string;
  username: string | null;
  createdAt: string;
}

/** How far back the card counts. The API caps a range at 366 days, so this is
 *  "the last year", not "all time" — the heading says so rather than implying
 *  a lifetime total. */
const LEAD_CARD_DAYS = 365;

function CollectedEmailsCard({ campaignId }: { campaignId: string }) {
  const toast = useToast();
  const [leads, setLeads] = useState<LeadPreview[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const from = new Date(Date.now() - (LEAD_CARD_DAYS - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    try {
      const data = await apiCall<{
        leads: LeadPreview[];
        pagination: { total: number };
      }>(
        `/api/leads?automationId=${encodeURIComponent(campaignId)}&from=${from}&limit=5`,
        { cache: "no-store" }
      );
      setLeads(data.leads);
      setTotal(data.pagination.total);
    } catch (err) {
      const message = errorMessage(err, "Failed to load collected emails");
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [campaignId, toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <div className="panel space-y-3 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">Collected emails</h2>
          <p className="text-xs text-muted">Last 12 months</p>
        </div>
        {!loading && !error && (
          <p className="text-lg font-semibold tabular-nums text-foreground">{total}</p>
        )}
      </div>

      {loading && <div className="h-16 animate-pulse rounded bg-surface-hover" />}

      {!loading && error && (
        <div>
          <p className="text-xs text-error">{error}</p>
          <button
            type="button"
            className="btn btn-secondary btn-sm mt-2"
            onClick={() => void load()}
          >
            <IconRefresh size={14} />
            Retry
          </button>
        </div>
      )}

      {!loading && !error && total === 0 && (
        <p className="text-xs text-muted">
          No emails yet. Turn on <span className="text-foreground">Email gate</span> when
          editing this campaign to ask for an email before the link goes out.
        </p>
      )}

      {!loading && !error && leads.length > 0 && (
        <>
          <ul className="space-y-1">
            {leads.map((lead) => (
              <li key={lead.id} className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm text-foreground" title={lead.email}>
                  {lead.email}
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {lead.username ? `@${lead.username}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <Link
            href={`/leads?automationId=${encodeURIComponent(campaignId)}`}
            className="btn btn-secondary btn-sm w-full"
          >
            View all emails
          </Link>
        </>
      )}
    </div>
  );
}

/* ------------------------------ small parts ------------------------------ */

function Summary({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

function FieldBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-surface px-3 py-2 text-sm text-foreground">
      {children}
    </div>
  );
}

function TabButton({
  id,
  active,
  onClick,
  children,
}: {
  id: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`border-b-2 pb-2 text-sm font-medium ${
        active
          ? "border-accent text-foreground"
          : "border-transparent text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
