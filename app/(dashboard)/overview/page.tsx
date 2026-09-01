"use client";

/**
 * Instagram Overview Page
 *
 * Aggregate reach/engagement across your recent posts, plus a per-post table.
 * Views / reach / saved / shares come from Instagram media insights (requires
 * the insights permission); likes and comments are always available.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import AccountSelect from "@/components/account-select";
import StatCard from "@/components/stat-card";
import FollowerChart from "@/components/follower-chart";
import { SortableTh, useSort } from "@/components/sortable-th";
import { IconDownload, IconRefresh, IconSearch } from "@/components/icons";
import { useToast } from "@/components/toast";
import { downloadCsv, toCsv } from "@/lib/utils/csv";
import type {
  OverviewPost,
  OverviewResponse,
} from "@/app/api/instagram/overview/route";

function formatNumber(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const COUNT_OPTIONS = [
  { value: "25", label: "Last 25" },
  { value: "50", label: "Last 50" },
  { value: "100", label: "Last 100" },
  { value: "all", label: "All time" },
];

type PostSortCol =
  | "caption"
  | "views"
  | "reach"
  | "likes"
  | "comments"
  | "saved"
  | "shares"
  | "timestamp";

const EMPTY_POSTS: OverviewPost[] = [];

function postLabel(p: OverviewPost): string {
  return p.caption || `${p.mediaType} post`;
}

export default function OverviewPage() {
  const toast = useToast();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [count, setCount] = useState("50");
  const [query, setQuery] = useState("");

  // `loading` starts true and is re-armed by the handlers below before a
  // parameter change or a manual retry, not inside the effect itself.
  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (selectedAccountId !== "all") {
      params.set("instagramAccountId", selectedAccountId);
    }
    params.set("count", count);
    try {
      const res = await fetch(`/api/instagram/overview?${params}`, {
        cache: "no-store",
      });
      const payload = await res.json();
      if (!payload.success) {
        throw new Error(payload.error ?? "Failed to load overview");
      }
      setData(payload.data);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load overview";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
    // toast is stable (memoized in the provider)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, count]);

  useEffect(() => {
    // load() only touches state after its first await; the lint rule cannot
    // see the async boundary. Same pattern as the inbox page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function reload() {
    setLoading(true);
    void load();
  }
  function handleCountChange(next: string) {
    setLoading(true);
    setCount(next);
  }
  function handleAccountChange(next: string) {
    setLoading(true);
    setSelectedAccountId(next);
  }

  // Hooks run on every render, so the table's search + sort live above the
  // loading/error returns and operate on an empty list until data arrives.
  const posts = data?.posts ?? EMPTY_POSTS;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = useMemo(
    () =>
      normalizedQuery
        ? posts.filter((p) => postLabel(p).toLocaleLowerCase().includes(normalizedQuery))
        : posts,
    [posts, normalizedQuery]
  );
  const { sorted, sort, toggle } = useSort<OverviewPost, PostSortCol>(
    filtered,
    "timestamp",
    "desc",
    (row, col) => (col === "caption" ? postLabel(row) : row[col])
  );

  function exportCsv() {
    if (!data) return;
    try {
      const csv = toCsv(sorted, [
        { header: "Date", value: (p) => p.timestamp.slice(0, 10) },
        { header: "Caption", value: (p) => p.caption ?? "" },
        { header: "Type", value: (p) => p.mediaType },
        { header: "Views", value: (p) => p.views },
        { header: "Reach", value: (p) => p.reach },
        { header: "Likes", value: (p) => p.likes },
        { header: "Comments", value: (p) => p.comments },
        { header: "Saved", value: (p) => p.saved },
        { header: "Shares", value: (p) => p.shares },
        { header: "Permalink", value: (p) => p.permalink ?? "" },
      ]);
      downloadCsv(`posts-${data.account.username}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      toast.success(`Exported ${sorted.length} post${sorted.length === 1 ? "" : "s"}`);
    } catch {
      toast.error("Could not export CSV");
    }
  }

  if (loading) {
    return (
      <div className="space-y-8" aria-busy="true">
        <div className="h-8 w-40 rounded bg-surface-hover" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="panel h-24 p-4 sm:p-5">
              <div className="h-4 w-16 rounded bg-surface-hover" />
              <div className="mt-3 h-6 w-20 rounded bg-surface-hover" />
            </div>
          ))}
        </div>
        <div className="panel h-72 p-4 sm:p-6">
          <div className="h-4 w-40 rounded bg-surface-hover" />
        </div>
        <div className="panel p-4 sm:p-6">
          <div className="h-4 w-24 rounded bg-surface-hover" />
          {[...Array(5)].map((_, i) => (
            <div key={i} className="mt-3 h-10 rounded bg-surface-hover" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    const message = error ?? "Failed to load overview";
    return (
      <div className="panel p-8 text-center">
        <p className="text-sm text-error">{message}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={reload}
            className="btn btn-secondary"
          >
            <IconRefresh size={16} />
            Retry
          </button>
          {message.toLowerCase().includes("connect") && (
            <a href="/api/instagram/connect" className="btn btn-primary">
              Connect Instagram
            </a>
          )}
        </div>
      </div>
    );
  }

  const { totals, accounts, insightsAvailable, followers, followerHistory } =
    data;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">Overview</h1>
          <p className="mt-1 text-sm text-muted">
            {data.requestedCount === "all" ? "All-time" : "Recent"} —{" "}
            {totals.posts} post{totals.posts === 1 ? "" : "s"} from @
            {data.account.username}
            {data.truncated ? ` (capped at ${totals.posts})` : ""}
          </p>
          {followers !== null && (
            // Kept out of the tile row below: that row sums the selected posts,
            // whereas this is a current account-level total.
            <p className="mt-1 text-sm text-muted">
              {followers.toLocaleString()} followers
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="field-label mb-0">Range</span>
            <select
              value={count}
              onChange={(e) => handleCountChange(e.target.value)}
              className="input w-auto"
            >
              {COUNT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {accounts.length > 1 && (
            <AccountSelect
              accounts={accounts.map((a) => ({
                id: a.id,
                username: a.username,
                instagramId: a.id,
              }))}
              value={selectedAccountId}
              onChange={handleAccountChange}
            />
          )}
        </div>
      </div>

      {!insightsAvailable && (
        <div className="panel border-warning/40 bg-warning-soft p-4">
          <p className="text-sm text-foreground">
            Views, reach, saved and shares need the insights permission.
          </p>
          <p className="mt-1 text-sm text-muted">
            Reconnect your account to grant it — likes and comments are shown in
            the meantime.
          </p>
          <a href="/api/instagram/connect" className="btn btn-secondary btn-sm mt-3">
            Reconnect Instagram
          </a>
        </div>
      )}

      {/* Aggregate totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
        <StatCard label="Views" value={formatNumber(totals.views)} />
        <StatCard label="Reach" value={formatNumber(totals.reach)} />
        <StatCard label="Likes" value={formatNumber(totals.likes)} />
        <StatCard label="Comments" value={formatNumber(totals.comments)} />
        <StatCard label="Saved" value={formatNumber(totals.saved)} />
        <StatCard label="Shares" value={formatNumber(totals.shares)} />
      </div>

      {/* Follower trend — account-level, independent of the post range */}
      <FollowerChart data={followerHistory} followers={followers} />

      {/* Per-post table */}
      <div className="panel p-4 sm:p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="section-title">
            Posts
            {normalizedQuery && (
              <span className="ml-2 text-xs font-normal text-muted">
                {filtered.length} of {posts.length}
              </span>
            )}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative block">
              <span className="sr-only">Search captions</span>
              <IconSearch
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search captions"
                className="input input-sm w-56 pl-8"
              />
            </label>
            <button
              type="button"
              onClick={exportCsv}
              disabled={sorted.length === 0}
              className="btn btn-secondary btn-sm"
            >
              <IconDownload size={14} />
              Export CSV
            </button>
          </div>
        </div>

        {posts.length === 0 ? (
          <div className="rounded-md border border-border bg-background p-8 text-center">
            <p className="text-sm text-foreground">No posts found</p>
            <p className="mt-1 text-sm text-muted">
              Publish on @{data.account.username} and it will show up here after
              the next refresh.
            </p>
            <button
              type="button"
              onClick={reload}
              className="btn btn-secondary btn-sm mt-3"
            >
              <IconRefresh size={14} />
              Refresh
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-md border border-border bg-background p-8 text-center">
            <p className="text-sm text-foreground">
              No captions match &ldquo;{query.trim()}&rdquo;
            </p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="btn btn-secondary btn-sm mt-3"
            >
              Clear search
            </button>
          </div>
        ) : (
          // Eight metric columns can't compress into a phone; the wrapper
          // scrolls horizontally inside the panel instead.
          <div className="table-wrap">
            <table className="table min-w-[760px]">
              <caption className="sr-only">
                Recent posts from @{data.account.username} with engagement metrics
              </caption>
              <thead>
                <tr>
                  <SortableTh col="caption" sort={sort} onToggle={toggle}>
                    Post
                  </SortableTh>
                  <SortableTh col="views" sort={sort} onToggle={toggle} className="num">
                    Views
                  </SortableTh>
                  <SortableTh col="reach" sort={sort} onToggle={toggle} className="num">
                    Reach
                  </SortableTh>
                  <SortableTh col="likes" sort={sort} onToggle={toggle} className="num">
                    Likes
                  </SortableTh>
                  <SortableTh col="comments" sort={sort} onToggle={toggle} className="num">
                    Comments
                  </SortableTh>
                  <SortableTh col="saved" sort={sort} onToggle={toggle} className="num">
                    Saved
                  </SortableTh>
                  <SortableTh col="shares" sort={sort} onToggle={toggle} className="num">
                    Shares
                  </SortableTh>
                  <SortableTh col="timestamp" sort={sort} onToggle={toggle} className="num">
                    Date
                  </SortableTh>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => {
                  const label = postLabel(p);
                  return (
                    <tr key={p.id}>
                      <td className="max-w-xs">
                        <div className="flex items-center gap-3">
                          {p.thumbnailUrl ? (
                            // Instagram CDN hosts are not in next.config images,
                            // so a plain img is the right tool here.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={p.thumbnailUrl}
                              alt={label}
                              width={48}
                              height={48}
                              loading="lazy"
                              className="h-12 w-12 shrink-0 rounded-md bg-surface-hover object-cover"
                            />
                          ) : (
                            <div
                              aria-hidden
                              className="h-12 w-12 shrink-0 rounded-md bg-surface-hover"
                            />
                          )}
                          <div className="min-w-0">
                            {p.permalink ? (
                              <a
                                href={p.permalink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block truncate text-foreground hover:text-accent"
                              >
                                {label}
                              </a>
                            ) : (
                              <span className="block truncate text-foreground">
                                {label}
                              </span>
                            )}
                            <span className="text-xs text-muted">{p.mediaType}</span>
                          </div>
                        </div>
                      </td>
                      <td className="num text-muted">{formatNumber(p.views)}</td>
                      <td className="num text-muted">{formatNumber(p.reach)}</td>
                      <td className="num text-muted">{formatNumber(p.likes)}</td>
                      <td className="num text-muted">{formatNumber(p.comments)}</td>
                      <td className="num text-muted">{formatNumber(p.saved)}</td>
                      <td className="num text-muted">{formatNumber(p.shares)}</td>
                      <td className="num text-muted">{formatDate(p.timestamp)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
