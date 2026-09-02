"use client";

/**
 * Dashboard Home Page
 *
 * Overview cards (range-scoped + lifetime), daily DM chart over the selected
 * range, rate-limit panel, top keywords and recent activity.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import DateRangePicker, {
  rangeForDays,
  rangeToParams,
  type DateRange,
} from "@/components/date-range-picker";
import RateLimitWidget from "@/components/rate-limit-widget";
import StatCard from "@/components/stat-card";
import StatusBadge from "@/components/status-badge";
import { useToast } from "@/components/toast";

interface DashboardStats {
  userName: string | null;
  contactsCount: number;
  totalAutomations: number;
  activeAutomations: number;
  dmsSentToday: number;
  dmsSentWeek: number;
  dmsSentMonth: number;
  dmsSkippedMonth: number;
  dmsFailedMonth: number;
  totalDMs: number;
  clicksThisMonth: number;
  totalClicks: number;
  ctrThisMonth: number;
  instagramAccounts: AccountOption[];
  selectedInstagramAccountId: string | null;
  range: { from: string; to: string; days: number };
  topKeywords: { keyword: string; count: number }[];
  dailyDMs: { date: string; count: number }[];
  recentLogs: Array<{
    id: string;
    commenterName: string | null;
    commentText: string;
    status: string;
    createdAt: string;
    automation: { name: string };
    instagramAccount?: { username: string };
  }>;
}

const nf = new Intl.NumberFormat("en-US");

function shortDay(key: string): string {
  // "2026-09-02" → "Sep 2" without timezone drift.
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function rangeLabel(range: { from: string; to: string; days: number } | undefined): string {
  if (!range) return "";
  return `${shortDay(range.from)} – ${shortDay(range.to)} · ${range.days} days`;
}

export default function DashboardPage() {
  const toast = useToast();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [range, setRange] = useState<DateRange>(() => rangeForDays(30));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = rangeToParams(range);
      if (selectedAccountId !== "all") {
        params.set("instagramAccountId", selectedAccountId);
      }
      const res = await fetch(`/api/dashboard/stats?${params}`);
      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.error ?? `HTTP ${res.status}`);
      }
      setStats(payload.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load dashboard";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [range, selectedAccountId, toast]);

  // Deferred a tick: the effect itself must not set state synchronously, and the
  // cleanup drops a fetch that a filter change superseded before it started.
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  if (loading && !stats) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="h-8 w-48 rounded bg-surface-hover" />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="panel h-24 p-4">
              <div className="h-4 w-20 rounded bg-surface-hover" />
              <div className="mt-3 h-7 w-16 rounded bg-surface-hover" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
          <div className="panel h-64 lg:col-span-4" />
          <div className="panel h-64 lg:col-span-2" />
        </div>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="panel p-8 text-center">
        <p className="text-sm font-medium text-error">Couldn&apos;t load the dashboard</p>
        <p className="mt-1 text-sm text-muted">{error}</p>
        <button type="button" className="btn btn-primary mt-4" onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }

  const dailyDMs = stats?.dailyDMs ?? [];
  const maxDM = Math.max(...dailyDMs.map((d) => d.count), 1);
  const connectedCount = stats?.instagramAccounts.length ?? 0;
  // Beyond two weeks the chart scrolls horizontally instead of squeezing bars;
  // labels thin out so they never overlap.
  const wide = dailyDMs.length > 14;
  const BAR_AREA_PX = 112; // h-40 minus value/date labels
  const labelEvery = dailyDMs.length <= 14 ? 1 : dailyDMs.length <= 31 ? 5 : 15;

  return (
    <div className="space-y-6" aria-busy={loading}>
      {/* Greeting header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
            Hello, {stats?.userName ?? "there"}!
          </h1>
          <p className="mt-1 text-sm text-muted">
            {connectedCount} connected {connectedCount === 1 ? "account" : "accounts"}
            {" · "}
            {nf.format(stats?.contactsCount ?? 0)}{" "}
            {stats?.contactsCount === 1 ? "contact" : "contacts"}
            {" · "}
            <Link href="/logs" className="text-accent hover:underline">
              See activity
            </Link>
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <DateRangePicker value={range} onChange={setRange} />
          {stats && stats.instagramAccounts.length > 1 && (
            <AccountSelect
              accounts={stats.instagramAccounts}
              value={selectedAccountId}
              onChange={setSelectedAccountId}
            />
          )}
        </div>
      </div>

      {error && stats && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-error/40 bg-error-soft px-3 py-2 text-sm text-error"
        >
          <span>Refresh failed: {error}. Showing the last loaded data.</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {/* Range-scoped cards */}
      <section aria-labelledby="range-stats-heading">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 id="range-stats-heading" className="section-title">
            Selected range
          </h2>
          <span className="text-xs text-muted">{rangeLabel(stats?.range)}</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard
            label="Active Campaigns"
            value={nf.format(stats?.activeAutomations ?? 0)}
            hint={`${nf.format(stats?.totalAutomations ?? 0)} total`}
          />
          <StatCard
            label="DMs Sent"
            value={nf.format(stats?.dmsSentMonth ?? 0)}
            hint={`${nf.format(stats?.dmsSentToday ?? 0)} today · ${nf.format(
              stats?.dmsSentWeek ?? 0
            )} this week`}
          />
          <StatCard label="Skipped" value={nf.format(stats?.dmsSkippedMonth ?? 0)} />
          <StatCard label="Failed" value={nf.format(stats?.dmsFailedMonth ?? 0)} />
          <StatCard label="Clicks" value={nf.format(stats?.clicksThisMonth ?? 0)} />
          <StatCard label="CTR" value={`${stats?.ctrThisMonth ?? 0}%`} hint="clicks ÷ DMs sent" />
        </div>
      </section>

      {/* Lifetime totals */}
      <section aria-labelledby="lifetime-stats-heading">
        <h2 id="lifetime-stats-heading" className="section-title mb-2">
          All time
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard label="Total DMs" value={nf.format(stats?.totalDMs ?? 0)} />
          <StatCard label="Total Clicks" value={nf.format(stats?.totalClicks ?? 0)} />
          <StatCard label="Total Campaigns" value={nf.format(stats?.totalAutomations ?? 0)} />
          <StatCard label="Contacts" value={nf.format(stats?.contactsCount ?? 0)} />
        </div>
      </section>

      {/* Chart + Rate limit */}
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-6">
        <div className="panel p-4 sm:p-6 lg:col-span-4">
          <div className="mb-6 flex items-baseline justify-between gap-2">
            <h2 className="section-title">DMs sent per day</h2>
            <span className="text-xs text-muted">{rangeLabel(stats?.range)}</span>
          </div>
          {dailyDMs.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted">No data for this range</p>
          ) : (
            <div className={wide ? "overflow-x-auto pb-1" : ""}>
              <div
                role="img"
                aria-label={`Daily DMs sent, ${dailyDMs.length} days, peak ${maxDM}`}
                className={`flex h-40 items-end gap-1 sm:gap-1.5 ${wide ? "" : "w-full"}`}
                style={wide ? { minWidth: `${dailyDMs.length * 14}px` } : undefined}
              >
                {dailyDMs.map((day, i) => {
                  const showLabel = i % labelEvery === 0 || i === dailyDMs.length - 1;
                  return (
                    <div
                      key={day.date}
                      className={`flex h-full min-w-0 flex-col items-center justify-end gap-1 ${wide ? "w-3 shrink-0" : "flex-1"}`}
                      title={`${shortDay(day.date)}: ${nf.format(day.count)} DM${day.count === 1 ? "" : "s"}`}
                    >
                      {!wide && (
                        <span className="text-xs font-medium tabular-nums text-muted">{day.count}</span>
                      )}
                      <div
                        className="w-full flex-none rounded-sm bg-accent transition-[height] hover:bg-accent-hover"
                        // Pixel height, not %: the column is a flex item with
                        // auto height, so a % height would resolve to 0 and the
                        // bar vanishes (it did — 172 DMs rendered as an empty chart).
                        style={{ height: `${Math.max(Math.round((day.count / maxDM) * BAR_AREA_PX), 3)}px` }}
                      />
                      {/* Wide mode: 12px columns, so shown labels spill over their
                          hidden neighbours instead of being truncated to nothing. */}
                      <span
                        className={`w-full text-center text-xs text-muted ${
                          wide ? "overflow-visible whitespace-nowrap" : "truncate"
                        } ${showLabel ? "" : "invisible"}`}
                      >
                        {shortDay(day.date)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="panel p-4 sm:p-6 lg:col-span-2">
          <RateLimitWidget compact instagramAccountId={selectedAccountId} />
        </div>
      </div>

      {/* Keywords + Recent Activity */}
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-6">
        <div className="panel p-4 sm:p-6 lg:col-span-2">
          <div className="mb-4 flex items-baseline justify-between gap-2">
            <h2 className="section-title">Top Keywords</h2>
            <span className="text-xs text-muted">all time</span>
          </div>
          {stats?.topKeywords.length === 0 ? (
            <p className="py-8 text-sm text-muted">
              No keyword matches yet.{" "}
              <Link href="/campaigns" className="text-accent hover:underline">
                Create a campaign
              </Link>
            </p>
          ) : (
            <ul className="space-y-3">
              {stats?.topKeywords.map((keyword) => (
                <li key={keyword.keyword} className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium text-foreground">
                    {keyword.keyword}
                  </span>
                  <span className="text-xs tabular-nums text-muted">{nf.format(keyword.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel p-4 sm:p-6 lg:col-span-4">
          <div className="mb-4 flex items-baseline justify-between gap-2">
            <h2 className="section-title">Recent Activity</h2>
            <Link href="/logs" className="text-xs text-accent hover:underline">
              All logs
            </Link>
          </div>
          {stats?.recentLogs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              No activity yet — DMs show up here as comments are matched.
            </p>
          ) : (
            <div className="table-wrap max-h-72 overflow-y-auto">
              <table className="table">
                <caption className="sr-only">Ten most recent DM log entries</caption>
                <thead>
                  <tr>
                    <th scope="col">Commenter</th>
                    <th scope="col">Comment</th>
                    <th scope="col">Campaign</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stats?.recentLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="whitespace-nowrap font-medium text-foreground">
                        @{log.commenterName ?? "unknown"}
                        {log.instagramAccount && (
                          <span className="block text-xs font-normal text-muted">
                            via @{log.instagramAccount.username}
                          </span>
                        )}
                      </td>
                      <td className="max-w-[260px]">
                        <span className="block truncate text-muted" title={log.commentText}>
                          {log.commentText}
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-muted">{log.automation.name}</td>
                      <td>
                        <StatusBadge status={log.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
