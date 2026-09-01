"use client";

/**
 * Rate-limit status per Instagram account.
 *
 * Reads /api/admin/rate-limit (burst 8/min + hourly 750, pending queue jobs)
 * and refreshes every 30 s while the tab is visible. `compact` drops the
 * header/summary so it can sit inside a dashboard panel; the full version is
 * meant for /diagnostics.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { IconRefresh } from "@/components/icons";
import { useToast } from "@/components/toast";

interface WindowStatus {
  used: number;
  max: number;
  resetsAt: string | null;
}
interface AccountRateStatus {
  accountId: string;
  username: string;
  burst: WindowStatus;
  hourly: WindowStatus;
  pendingJobs: number;
}
interface RateLimitPayload {
  checkedAt: string;
  limits: {
    burst: { max: number; windowSec: number };
    hourly: { max: number; windowSec: number };
  };
  accounts: AccountRateStatus[];
}

const REFRESH_MS = 30_000;

function tone(used: number, max: number): "success" | "warning" | "error" {
  if (max <= 0) return "success";
  const ratio = used / max;
  if (ratio >= 1) return "error";
  if (ratio >= 0.75) return "warning";
  return "success";
}

function resetLabel(resetsAt: string | null, now: number): string {
  if (!resetsAt) return "idle";
  const sec = Math.max(0, Math.round((new Date(resetsAt).getTime() - now) / 1000));
  if (sec >= 90) return `resets in ${Math.ceil(sec / 60)} min`;
  return `resets in ${sec}s`;
}

function Bar({ label, win, now }: { label: string; win: WindowStatus; now: number }) {
  const t = tone(win.used, win.max);
  const pct = win.max > 0 ? Math.min(100, Math.round((win.used / win.max) * 100)) : 0;
  const fill = t === "error" ? "bg-error" : t === "warning" ? "bg-warning" : "bg-accent";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums text-foreground">
          {win.used}/{win.max}
          <span className="ml-1 text-muted">· {resetLabel(win.resetsAt, now)}</span>
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={win.max}
        aria-valuenow={win.used}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover"
        title={`${win.used} of ${win.max} used`}
      >
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

interface Props {
  compact?: boolean;
  /** Restrict to one account ("all" or undefined = every account). */
  instagramAccountId?: string;
  className?: string;
}

export default function RateLimitWidget({ compact = false, instagramAccountId, className = "" }: Props) {
  const toast = useToast();
  const [data, setData] = useState<RateLimitPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams();
        if (instagramAccountId && instagramAccountId !== "all") {
          params.set("instagramAccountId", instagramAccountId);
        }
        const res = await fetch(`/api/admin/rate-limit${params.size ? `?${params}` : ""}`);
        const payload = await res.json();
        if (!res.ok || !payload.success) {
          throw new Error(payload.error ?? `HTTP ${res.status}`);
        }
        setData(payload.data);
        setError(null);
        setNow(Date.now());
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load rate limits";
        setError(message);
        if (!silent) toast.error(message);
      } finally {
        setLoading(false);
      }
    },
    [instagramAccountId, toast]
  );

  // Initial load + 30 s refresh, paused while the tab is hidden.
  useEffect(() => {
    let timer: number | null = null;
    const start = () => {
      if (timer !== null) return;
      timer = window.setInterval(() => void load(true), REFRESH_MS);
    };
    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void load(true);
        start();
      } else {
        stop();
      }
    };
    // First load is deferred a tick so the effect body never sets state itself.
    const first = window.setTimeout(() => void load(), 0);
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(first);
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  // Tick the "resets in" labels once a second without refetching.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const accounts = data?.accounts ?? [];
  const totalPending = accounts.reduce((sum, a) => sum + a.pendingJobs, 0);

  return (
    <section className={className} aria-busy={loading}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="section-title">Rate limit</h2>
          {!compact && data && (
            <p className="text-xs text-muted">
              Burst {data.limits.burst.max}/{data.limits.burst.windowSec}s · Hourly{" "}
              {data.limits.hourly.max}/{data.limits.hourly.windowSec / 60} min ·{" "}
              {totalPending} pending job{totalPending === 1 ? "" : "s"}
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh rate limits"
          title="Refresh"
        >
          <IconRefresh size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {loading && !data && (
        <div className="space-y-3" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-24 rounded bg-surface-hover" />
              <div className="h-1.5 w-full rounded bg-surface-hover" />
              <div className="h-1.5 w-full rounded bg-surface-hover" />
            </div>
          ))}
        </div>
      )}

      {error && !data && !loading && (
        <div className="rounded-md border border-error/40 bg-error-soft p-3 text-sm text-error">
          <p>{error}</p>
          <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {data && accounts.length === 0 && (
        <p className="text-sm text-muted">
          No Instagram account connected yet.{" "}
          <Link href="/settings" className="text-accent hover:underline">
            Connect one
          </Link>
        </p>
      )}

      {data && accounts.length > 0 && (
        <ul className="space-y-4">
          {accounts.map((a) => (
            <li key={a.accountId} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-foreground">@{a.username}</span>
                <span
                  className={`pill ${a.pendingJobs > 0 ? "pill-info" : "pill-muted"}`}
                  title="Queued jobs waiting for this account"
                >
                  {a.pendingJobs} pending
                </span>
              </div>
              <Bar label="Burst (per minute)" win={a.burst} now={now} />
              <Bar label="Hourly" win={a.hourly} now={now} />
            </li>
          ))}
        </ul>
      )}

      {data && error && (
        <p className="mt-2 text-xs text-error" role="status">
          Last refresh failed: {error}
        </p>
      )}
      {data && !compact && (
        <p className="mt-3 text-xs text-muted">
          Checked {new Date(data.checkedAt).toLocaleTimeString()} · refreshes every 30s
        </p>
      )}
    </section>
  );
}
