"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import StatusBadge from "@/components/status-badge";
import StatCard from "@/components/stat-card";
import RateLimitWidget from "@/components/rate-limit-widget";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { IconAlert, IconRefresh } from "@/components/icons";

/* ───────────────────────────── Types ───────────────────────────── */

interface DiagnosticsData {
  queueCounts: Record<string, number>;
  workerHealth: {
    healthy: boolean;
    ageMs: number | null;
    heartbeat: {
      checkedAt: string;
      hostname?: string;
      pid: number;
      startedAt?: string;
      region?: string;
    } | null;
  };
  workerAlerts: Array<{
    level: string;
    message: string;
    jobId?: string;
    commentId?: string;
    createdAt: string;
  }>;
  webhookEvents: Array<{
    id: string;
    workspaceId: string | null;
    object: string | null;
    status: "PENDING" | "PROCESSED" | "FAILED";
    errorMessage: string | null;
    createdAt: string;
    processedAt: string | null;
  }>;
  dmFailures: Array<{
    id: string;
    status: string;
    commentId: string;
    commentText: string;
    errorMessage: string | null;
    updatedAt: string;
    automation: { name: string };
  }>;
  dmFailureGroups: Array<{
    errorMessage: string | null;
    count: number;
    lastSeen: string | null;
  }>;
  tokenRefreshFailures: Array<{
    id: string;
    message: string;
    createdAt: string;
  }>;
  operationalEvents: Array<{
    id: string;
    source: string;
    level: "INFO" | "WARNING" | "ERROR";
    message: string;
    payload: unknown;
    createdAt: string;
    resolvedAt: string | null;
  }>;
}

interface QueueJob {
  id: string;
  name: string;
  data: unknown;
  status: "PENDING" | "ACTIVE" | "DONE" | "FAILED";
  dedupeKey: string | null;
  runAt: string;
  attempts: number;
  maxAttempts: number;
  lockedAt: string | null;
  lastError: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface QueueData {
  jobs: QueueJob[];
  stuckCount: number;
  stuckThresholdMinutes: number;
  scopedToAccounts: number;
}

type QueueFilter = "OPEN" | "ALL" | "PENDING" | "ACTIVE" | "FAILED" | "DONE";
type WebhookFilter = "ALL" | "PENDING" | "PROCESSED" | "FAILED";
type OpsFilter = "all" | "open" | "resolved";

const AUTO_REFRESH_MS = 30_000;
const HEARTBEAT_RED_MS = 3 * 60_000;

/* ─────────────────────────── Helpers ─────────────────────────── */

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function formatClock(date: Date) {
  return date.toLocaleTimeString([], { hour12: false });
}

function ageLabel(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

function truncate(value: string, max = 64) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function readJson<T>(response: Response): Promise<{ success: true; data: T } | { success: false; error: string }> {
  const payload = (await response.json().catch(() => null)) as
    | { success: boolean; data?: T; error?: string }
    | null;
  if (!payload) return { success: false, error: `Request failed (${response.status}).` };
  if (payload.success && payload.data !== undefined) return { success: true, data: payload.data };
  return { success: false, error: payload.error ?? `Request failed (${response.status}).` };
}

/* ────────────────────────── Sub-components ────────────────────────── */

function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title text-base">{title}</h2>
          {description && <p className="mt-1 text-xs text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded bg-surface-hover" />
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded border border-error bg-error-soft p-4">
      <p className="flex items-center gap-2 text-sm text-error">
        <IconAlert size={16} />
        {message}
      </p>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

function EmptyState({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="py-6 text-center">
      <p className="text-sm text-muted">{label}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Loading → error → empty → content, in that order. */
function SectionBody({
  loading,
  error,
  onRetry,
  empty,
  emptyLabel,
  emptyHint,
  rows,
  children,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  empty: boolean;
  emptyLabel: string;
  emptyHint?: string;
  rows?: number;
  children: React.ReactNode;
}) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (loading) return <Skeleton rows={rows} />;
  if (empty) return <EmptyState label={emptyLabel} hint={emptyHint} />;
  return <>{children}</>;
}

function LevelBadge({ level }: { level: string }) {
  if (level === "ERROR" || level === "error") return <StatusBadge status="FAILED" label="Error" />;
  if (level === "WARNING" || level === "warning") return <StatusBadge status="PENDING" label="Warning" />;
  return <StatusBadge status="QUEUED" label={level.charAt(0) + level.slice(1).toLowerCase()} />;
}

function QueueStatusBadge({ status }: { status: QueueJob["status"] }) {
  if (status === "ACTIVE") return <StatusBadge status="RUNNING" label="Active" />;
  return <StatusBadge status={status} />;
}

function WebhookStatusBadge({ status }: { status: string }) {
  if (status === "PROCESSED") return <StatusBadge status="SENT" label="Processed" />;
  return <StatusBadge status={status} />;
}

/* ──────────────────────────── Page ──────────────────────────── */

export default function DiagnosticsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  // Outside the provider useToast() returns a fresh object every render; keep
  // it behind a ref so the fetch callbacks (and their effects) never re-arm.
  const toastRef = useRef(toast);
  useEffect(() => { toastRef.current = toast; }, [toast]);

  const [diag, setDiag] = useState<DiagnosticsData | null>(null);
  const [diagLoading, setDiagLoading] = useState(true);
  const [diagError, setDiagError] = useState<string | null>(null);

  const [queue, setQueue] = useState<QueueData | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);

  const [queueFilter, setQueueFilter] = useState<QueueFilter>("OPEN");
  const [webhookFilter, setWebhookFilter] = useState<WebhookFilter>("ALL");
  const [opsFilter, setOpsFilter] = useState<OpsFilter>("all");

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  /* ---- loaders ---- */

  const loadDiagnostics = useCallback(async (silent = false) => {
    if (!silent) setDiagLoading(true);
    try {
      const params = new URLSearchParams({ webhookStatus: webhookFilter, ops: opsFilter });
      const result = await readJson<DiagnosticsData>(await fetch(`/api/admin/diagnostics?${params}`));
      if (!result.success) throw new Error(result.error);
      setDiag(result.data);
      setDiagError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Diagnostics could not be loaded.";
      setDiagError(message);
      if (!silent) toastRef.current.error(message);
    } finally {
      setDiagLoading(false);
      setLastUpdated(new Date());
    }
  }, [webhookFilter, opsFilter]);

  const loadQueue = useCallback(async (silent = false) => {
    if (!silent) setQueueLoading(true);
    try {
      const result = await readJson<QueueData>(await fetch(`/api/admin/queue?status=${queueFilter}`));
      if (!result.success) throw new Error(result.error);
      setQueue(result.data);
      setQueueError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Queue could not be loaded.";
      setQueueError(message);
      if (!silent) toastRef.current.error(message);
    } finally {
      setQueueLoading(false);
      setLastUpdated(new Date());
    }
  }, [queueFilter]);

  const refreshAll = useCallback(async (silent = false) => {
    setRefreshing(true);
    await Promise.all([loadDiagnostics(silent), loadQueue(silent)]);
    setRefreshing(false);
  }, [loadDiagnostics, loadQueue]);

  // Filters re-fetch only the part they affect.
  useEffect(() => { void loadDiagnostics(); }, [loadDiagnostics]);
  useEffect(() => { void loadQueue(); }, [loadQueue]);

  // Auto-refresh: 30s, silent (no skeleton flash, no toast spam); paused while
  // the tab is hidden and catches up the moment it becomes visible again.
  const refreshRef = useRef(refreshAll);
  useEffect(() => { refreshRef.current = refreshAll; }, [refreshAll]);
  useEffect(() => {
    if (!autoRefresh) return;
    const tick = () => { if (!document.hidden) void refreshRef.current(true); };
    const timer = window.setInterval(tick, AUTO_REFRESH_MS);
    const onVisible = () => { if (!document.hidden) void refreshRef.current(true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [autoRefresh]);

  /* ---- actions ---- */

  function markBusy(id: string, on: boolean) {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }

  async function retryJob(job: QueueJob) {
    markBusy(job.id, true);
    try {
      const result = await readJson<{ id: string }>(await fetch(`/api/admin/queue/${job.id}`, { method: "POST" }));
      if (!result.success) throw new Error(result.error);
      toast.success(`Job ${job.name} queued to run now.`);
      await loadQueue(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Retry failed.");
    } finally {
      markBusy(job.id, false);
    }
  }

  async function purgeJob(job: QueueJob) {
    const ok = await confirm({
      title: "Purge this job?",
      description: `${job.name} (${job.status}) will be deleted permanently. If it carries a dedupe key, the same comment can be queued again later.`,
      confirmLabel: "Purge",
      danger: true,
    });
    if (!ok) return;
    markBusy(job.id, true);
    try {
      const result = await readJson<{ id: string }>(await fetch(`/api/admin/queue/${job.id}`, { method: "DELETE" }));
      if (!result.success) throw new Error(result.error);
      toast.success("Job purged.");
      await loadQueue(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Purge failed.");
    } finally {
      markBusy(job.id, false);
    }
  }

  async function bulkQueue(action: "RETRY_FAILED" | "PURGE_DONE") {
    const ok = await confirm(
      action === "RETRY_FAILED"
        ? {
            title: "Retry all failed jobs?",
            description: "Every FAILED job in this workspace goes back to PENDING and runs on the next cron tick.",
            confirmLabel: "Retry all",
          }
        : {
            title: "Purge completed jobs older than 7 days?",
            description: "DONE jobs completed more than 7 days ago are deleted permanently.",
            confirmLabel: "Purge",
            danger: true,
          }
    );
    if (!ok) return;
    markBusy(action, true);
    try {
      const body = action === "RETRY_FAILED" ? { action } : { action, olderThanDays: 7 };
      const result = await readJson<{ count: number }>(
        await fetch("/api/admin/queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      );
      if (!result.success) throw new Error(result.error);
      toast.success(
        action === "RETRY_FAILED"
          ? `${result.data.count} failed job(s) re-queued.`
          : `${result.data.count} completed job(s) purged.`
      );
      await loadQueue(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Bulk action failed.");
    } finally {
      markBusy(action, false);
    }
  }

  async function resolveEvent(id: string) {
    markBusy(id, true);
    try {
      const result = await readJson<{ id: string }>(await fetch(`/api/admin/ops/${id}`, { method: "POST" }));
      if (!result.success) throw new Error(result.error);
      toast.success("Event resolved.");
      await loadDiagnostics(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Resolve failed.");
    } finally {
      markBusy(id, false);
    }
  }

  /* ---- derived ---- */

  const heartbeat = diag?.workerHealth.heartbeat ?? null;
  const heartbeatAge = diag?.workerHealth.ageMs ?? null;
  const heartbeatStale = heartbeatAge === null || heartbeatAge > HEARTBEAT_RED_MS;
  const initialLoading = diagLoading && !diag && !diagError;

  /* ---- render ---- */

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Production Diagnostics</h1>
          <p className="mt-1 text-sm text-muted">
            Health, queue, webhook events, rate limits, and operational alerts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted" aria-live="polite">
            {lastUpdated ? `Last updated ${formatClock(lastUpdated)}` : "Not loaded yet"}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={autoRefresh}
            onClick={() => setAutoRefresh((v) => !v)}
            className={`btn btn-sm ${autoRefresh ? "btn-primary" : "btn-secondary"}`}
          >
            Auto-refresh {autoRefresh ? "on" : "off"}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void refreshAll()}
            disabled={refreshing}
          >
            <IconRefresh size={14} className={refreshing ? "animate-spin" : undefined} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stat cards */}
      {diagError && !diag ? (
        <ErrorState message={diagError} onRetry={() => void loadDiagnostics()} />
      ) : initialLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="panel h-24 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-5">
          <div className="panel p-4">
            <p className="text-sm text-muted">Worker health</p>
            <p className={`mt-1 text-2xl font-semibold ${heartbeatStale ? "text-error" : "text-success"}`}>
              {heartbeatStale ? "Stale" : "Healthy"}
            </p>
            <p className="mt-1 text-xs text-muted">
              {heartbeatAge == null ? "No heartbeat found" : `Heartbeat ${ageLabel(heartbeatAge)}`}
            </p>
          </div>
          {(["waiting", "active", "delayed", "failed"] as const).map((key) => (
            <StatCard key={key} label={`Queue ${key}`} value={diag?.queueCounts[key] ?? 0} />
          ))}
        </div>
      )}

      {/* Worker health */}
      <Section title="Worker" description="Last cron drain / worker heartbeat. Red after 3 minutes without a beat.">
        <SectionBody
          loading={diagLoading && !diag}
          error={diagError}
          onRetry={() => void loadDiagnostics()}
          empty={!heartbeat}
          emptyLabel="No heartbeat recorded yet."
          emptyHint="The DM worker or the /api/cron/drain route writes one on every run."
          rows={2}
        >
          {heartbeat && (
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-xs uppercase text-muted">Last heartbeat</dt>
                <dd className="mt-1 flex items-center gap-2 text-foreground">
                  {heartbeatAge == null ? "—" : ageLabel(heartbeatAge)}
                  {heartbeatStale ? (
                    <StatusBadge status="FAILED" label="Stale" />
                  ) : (
                    <StatusBadge status="SENT" label="Fresh" />
                  )}
                </dd>
                <dd className="text-xs text-muted">{formatDate(heartbeat.checkedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted">Host</dt>
                <dd className="mt-1 text-foreground">{heartbeat.hostname ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted">PID</dt>
                <dd className="mt-1 tabular-nums text-foreground">{heartbeat.pid}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted">Started</dt>
                <dd className="mt-1 text-foreground">{formatDate(heartbeat.startedAt)}</dd>
              </div>
              {heartbeat.region && (
                <div>
                  <dt className="text-xs uppercase text-muted">Region</dt>
                  <dd className="mt-1 text-foreground">{heartbeat.region}</dd>
                </div>
              )}
            </dl>
          )}
        </SectionBody>
      </Section>

      {/* Rate limits (agent A widget) */}
      <Section title="Rate limits" description="Per-account Instagram send budget.">
        <RateLimitWidget />
      </Section>

      {/* Queue management */}
      <Section
        title="Queue"
        description={
          queue
            ? `Jobs for this workspace's ${queue.scopedToAccounts} Instagram account(s). Stuck = ACTIVE with a lock older than ${queue.stuckThresholdMinutes} min.`
            : "Jobs scoped to this workspace's Instagram accounts."
        }
        actions={
          <>
            {queue && queue.stuckCount > 0 && (
              <StatusBadge status="PENDING" label={`${queue.stuckCount} stuck`} />
            )}
            <label className="flex items-center gap-2 text-xs text-muted">
              Status
              <select
                className="input input-sm w-auto"
                value={queueFilter}
                onChange={(e) => setQueueFilter(e.target.value as QueueFilter)}
              >
                <option value="OPEN">Not done</option>
                <option value="ALL">All</option>
                <option value="PENDING">Pending</option>
                <option value="ACTIVE">Active</option>
                <option value="FAILED">Failed</option>
                <option value="DONE">Done</option>
              </select>
            </label>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy.has("RETRY_FAILED")}
              onClick={() => void bulkQueue("RETRY_FAILED")}
            >
              Retry all failed
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={busy.has("PURGE_DONE")}
              onClick={() => void bulkQueue("PURGE_DONE")}
            >
              Purge done &gt; 7d
            </button>
          </>
        }
      >
        <SectionBody
          loading={queueLoading && !queue}
          error={queueError}
          onRetry={() => void loadQueue()}
          empty={!queue?.jobs.length}
          emptyLabel="No jobs match this filter."
          emptyHint={queue?.scopedToAccounts === 0 ? "Connect an Instagram account to see its jobs." : "Change the status filter to see more."}
          rows={4}
        >
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Queue jobs</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Attempts</th>
                  <th scope="col">Run at</th>
                  <th scope="col">Locked at</th>
                  <th scope="col">Last error</th>
                  <th scope="col">Dedupe key</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {queue?.jobs.map((job) => {
                  const isBusy = busy.has(job.id);
                  return (
                    <tr key={job.id}>
                      <td className="font-medium text-foreground">{job.name}</td>
                      <td><QueueStatusBadge status={job.status} /></td>
                      <td className="num">{job.attempts}/{job.maxAttempts}</td>
                      <td className="whitespace-nowrap text-muted">{formatDate(job.runAt)}</td>
                      <td className="whitespace-nowrap text-muted">{formatDate(job.lockedAt)}</td>
                      <td className="max-w-xs text-error" title={job.lastError ?? undefined}>
                        {job.lastError ? truncate(job.lastError) : <span className="text-muted">—</span>}
                      </td>
                      <td className="max-w-[12rem] truncate text-xs text-muted" title={job.dedupeKey ?? undefined}>
                        {job.dedupeKey ?? "—"}
                      </td>
                      <td className="whitespace-nowrap">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={isBusy || job.status === "ACTIVE"}
                            title={job.status === "ACTIVE" ? "Wait for the lock to release" : "Run now"}
                            onClick={() => void retryJob(job)}
                          >
                            Retry
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={isBusy}
                            onClick={() => void purgeJob(job)}
                          >
                            Purge
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionBody>
      </Section>

      {/* Worker alerts */}
      <Section title="Recent worker alerts">
        <SectionBody
          loading={diagLoading && !diag}
          error={diagError}
          onRetry={() => void loadDiagnostics()}
          empty={!diag?.workerAlerts.length}
          emptyLabel="No worker alerts recorded."
        >
          <ul className="space-y-3">
            {diag?.workerAlerts.map((alert) => (
              <li
                key={`${alert.createdAt}-${alert.jobId ?? alert.message}`}
                className="rounded border border-border bg-background p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <p className="min-w-0 flex-1 break-words text-sm font-semibold text-foreground">
                    {alert.message}
                  </p>
                  <LevelBadge level={alert.level} />
                </div>
                <p className="mt-2 text-xs text-muted">
                  {formatDate(alert.createdAt)}
                  {alert.commentId ? ` · ${alert.commentId}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </SectionBody>
      </Section>

      {/* DM failures */}
      <Section title="Campaign DM failures and skips" description="Top error messages, then the latest 10 raw entries.">
        <SectionBody
          loading={diagLoading && !diag}
          error={diagError}
          onRetry={() => void loadDiagnostics()}
          empty={!diag?.dmFailures.length && !diag?.dmFailureGroups.length}
          emptyLabel="No DM failures or skips."
        >
          <div className="space-y-5">
            {diag?.dmFailureGroups.length ? (
              <div className="table-wrap">
                <table className="table">
                  <caption className="sr-only">DM failures grouped by error message</caption>
                  <thead>
                    <tr>
                      <th scope="col">Error message</th>
                      <th scope="col" className="num">Count</th>
                      <th scope="col">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diag.dmFailureGroups.map((g, i) => (
                      <tr key={`${g.errorMessage ?? "none"}-${i}`}>
                        <td className="max-w-md" title={g.errorMessage ?? undefined}>
                          {g.errorMessage ? truncate(g.errorMessage, 96) : <span className="text-muted">(no message)</span>}
                        </td>
                        <td className="num">{g.count}</td>
                        <td className="whitespace-nowrap text-muted">{formatDate(g.lastSeen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <ul className="divide-y divide-border">
              {diag?.dmFailures.map((item) => (
                <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                      {item.automation.name}
                    </p>
                    <StatusBadge status={item.status} />
                  </div>
                  <p className="mt-1 truncate text-xs text-muted">{item.commentText}</p>
                  {item.errorMessage && (
                    <p className="mt-1 text-xs text-error" title={item.errorMessage}>
                      {truncate(item.errorMessage, 120)}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted">{formatDate(item.updatedAt)}</p>
                </li>
              ))}
            </ul>
          </div>
        </SectionBody>
      </Section>

      {/* Webhook events */}
      <Section
        title="Webhook events"
        description="Last 20. Failed rows are red; rows that matched no account are amber."
        actions={
          <label className="flex items-center gap-2 text-xs text-muted">
            Status
            <select
              className="input input-sm w-auto"
              value={webhookFilter}
              onChange={(e) => setWebhookFilter(e.target.value as WebhookFilter)}
            >
              <option value="ALL">All</option>
              <option value="PENDING">Pending</option>
              <option value="PROCESSED">Processed</option>
              <option value="FAILED">Failed</option>
            </select>
          </label>
        }
      >
        <SectionBody
          loading={diagLoading && !diag}
          error={diagError}
          onRetry={() => void loadDiagnostics()}
          empty={!diag?.webhookEvents.length}
          emptyLabel="No webhook events match this filter."
          rows={4}
        >
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Webhook events</caption>
              <thead>
                <tr>
                  <th scope="col">Object</th>
                  <th scope="col">Status</th>
                  <th scope="col">Error</th>
                  <th scope="col">Received</th>
                  <th scope="col">Processed</th>
                </tr>
              </thead>
              <tbody>
                {diag?.webhookEvents.map((event) => {
                  const unmatched = event.workspaceId === null;
                  const tone =
                    event.status === "FAILED" ? "bg-error-soft!" : unmatched ? "bg-warning-soft!" : "";
                  return (
                    <tr key={event.id}>
                      <td className={`${tone} font-medium text-foreground`}>
                        {event.object ?? "Instagram webhook"}
                        {unmatched && (
                          <span className="ml-2 text-xs text-warning">unmatched</span>
                        )}
                      </td>
                      <td className={tone}><WebhookStatusBadge status={event.status} /></td>
                      <td className={`${tone} max-w-sm text-error`} title={event.errorMessage ?? undefined}>
                        {event.errorMessage ? truncate(event.errorMessage, 80) : <span className="text-muted">—</span>}
                      </td>
                      <td className={`${tone} whitespace-nowrap text-muted`}>{formatDate(event.createdAt)}</td>
                      <td className={`${tone} whitespace-nowrap text-muted`}>{formatDate(event.processedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionBody>
      </Section>

      {/* Token refresh failures */}
      <Section title="Token refresh failures">
        <SectionBody
          loading={diagLoading && !diag}
          error={diagError}
          onRetry={() => void loadDiagnostics()}
          empty={!diag?.tokenRefreshFailures.length}
          emptyLabel="No token refresh failures."
          rows={2}
        >
          <ul className="divide-y divide-border">
            {diag?.tokenRefreshFailures.map((event) => (
              <li key={event.id} className="py-3 first:pt-0 last:pb-0">
                <p className="text-sm font-semibold text-foreground">{event.message}</p>
                <p className="mt-1 text-xs text-muted">{formatDate(event.createdAt)}</p>
              </li>
            ))}
          </ul>
        </SectionBody>
      </Section>

      {/* Operational events */}
      <Section
        title="Operational events"
        description="Workspace and system-wide events. Resolving only stamps resolvedAt; nothing is deleted."
        actions={
          <label className="flex items-center gap-2 text-xs text-muted">
            Show
            <select
              className="input input-sm w-auto"
              value={opsFilter}
              onChange={(e) => setOpsFilter(e.target.value as OpsFilter)}
            >
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
            </select>
          </label>
        }
      >
        <SectionBody
          loading={diagLoading && !diag}
          error={diagError}
          onRetry={() => void loadDiagnostics()}
          empty={!diag?.operationalEvents.length}
          emptyLabel="No operational events match this filter."
          rows={4}
        >
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Operational events</caption>
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Level</th>
                  <th scope="col">Message</th>
                  <th scope="col">Created</th>
                  <th scope="col">State</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {diag?.operationalEvents.map((event) => {
                  const resolved = event.resolvedAt !== null;
                  const hasPayload = event.payload !== null && event.payload !== undefined;
                  return (
                    <tr key={event.id}>
                      <td className="whitespace-nowrap text-xs font-semibold text-muted">{event.source}</td>
                      <td><LevelBadge level={event.level} /></td>
                      <td className="max-w-lg">
                        <p className="text-foreground">{event.message}</p>
                        {hasPayload && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-xs text-muted">Payload</summary>
                            <pre className="mt-1 max-h-64 overflow-auto rounded bg-surface p-2 text-xs text-foreground">
                              {prettyJson(event.payload)}
                            </pre>
                          </details>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-muted">{formatDate(event.createdAt)}</td>
                      <td className="whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={resolved ? "RESOLVED" : "OPEN"} />
                          {resolved && (
                            <span className="text-xs text-muted">{formatDate(event.resolvedAt)}</span>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap">
                        {!resolved && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy.has(event.id)}
                            onClick={() => void resolveEvent(event.id)}
                          >
                            Resolve
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionBody>
      </Section>
    </div>
  );
}
