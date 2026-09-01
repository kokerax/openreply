"use client";

/**
 * DM Logs Page
 *
 * Server-filtered, server-sorted, paginated table of DM logs with CSV export.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import DateRangePicker, {
  rangeForDays,
  rangeToParams,
  type DateRange,
} from "@/components/date-range-picker";
import { IconDownload, IconSearch } from "@/components/icons";
import { SortableTh, type SortState } from "@/components/sortable-th";
import StatusBadge from "@/components/status-badge";
import { useToast } from "@/components/toast";
import { downloadCsv, toCsv } from "@/lib/utils/csv";

interface DmLog {
  id: string;
  commenterId: string;
  commenterName: string | null;
  commentText: string;
  status: string;
  errorMessage: string | null;
  publicReplyError: string | null;
  publicReplySentAt: string | null;
  createdAt: string;
  automation: { name: string; keywords: string[] };
  instagramAccount: { username: string };
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type SortCol = "createdAt" | "status" | "campaign" | "account";

const STATUS_FILTERS = [
  "ALL",
  "SENT",
  "FAILED",
  "PENDING",
  "SKIPPED_RATE_LIMIT",
  "SKIPPED_PLAN_LIMIT",
  "SKIPPED_DEDUP",
];

const PAGE_SIZE = 20;
const EXPORT_LIMIT = 5000;
const SEARCH_DEBOUNCE_MS = 300;
const COLUMN_COUNT = 8;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function LogsPage() {
  const toast = useToast();
  const [logs, setLogs] = useState<DmLog[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [statusFilter, setStatusFilter] = useState("ALL");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [range, setRange] = useState<DateRange>(() => rangeForDays(30));
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState<SortCol>>({ col: "createdAt", dir: "desc" });
  const [page, setPage] = useState(1);
  const requestSeq = useRef(0);

  // Debounce the search box → `search` drives the request.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const buildParams = useCallback(
    (overrides: Record<string, string> = {}) => {
      const params = rangeToParams(range);
      params.set("page", String(page));
      params.set("limit", String(PAGE_SIZE));
      params.set("sort", sort.col);
      params.set("dir", sort.dir);
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (selectedAccountId !== "all") params.set("instagramAccountId", selectedAccountId);
      if (search) params.set("q", search);
      for (const [k, v] of Object.entries(overrides)) params.set(k, v);
      return params;
    },
    [range, page, sort, statusFilter, selectedAccountId, search]
  );

  const fetchLogs = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/logs?${buildParams()}`);
      const data = await res.json();
      if (seq !== requestSeq.current) return; // a newer request superseded this one
      if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`);
      setLogs(data.data.logs);
      setPagination(data.data.pagination);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      const message = err instanceof Error ? err.message : "Failed to load logs";
      setError(message);
      toast.error(message);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [buildParams, toast]);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((res) => res.json())
      .then((payload) => {
        if (payload.success) setAccounts(payload.data.instagramAccounts ?? []);
      })
      .catch(() => {
        // Account list is a convenience filter; the table still loads without it.
        toast.info("Couldn't load the account filter");
      });
  }, [toast]);

  // Deferred a tick so the effect never sets state synchronously; the cleanup
  // also drops a fetch that a filter change superseded before it started.
  useEffect(() => {
    const t = window.setTimeout(() => void fetchLogs(), 0);
    return () => window.clearTimeout(t);
  }, [fetchLogs]);

  function resetPage<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  function toggleSort(col: SortCol) {
    setSort((s) =>
      s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "desc" }
    );
    setPage(1);
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const res = await fetch(`/api/logs?${buildParams({ page: "1", limit: String(EXPORT_LIMIT) })}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`);
      const rows: DmLog[] = data.data.logs;
      if (rows.length === 0) {
        toast.info("Nothing to export for these filters");
        return;
      }
      const csv = toCsv(rows, [
        { header: "Date", value: (r) => r.createdAt },
        { header: "Status", value: (r) => r.status },
        { header: "Commenter", value: (r) => r.commenterName ?? r.commenterId },
        { header: "Comment", value: (r) => r.commentText },
        { header: "Campaign", value: (r) => r.automation.name },
        { header: "Account", value: (r) => r.instagramAccount.username },
        { header: "Error", value: (r) => r.errorMessage },
        { header: "Public reply error", value: (r) => r.publicReplyError },
      ]);
      downloadCsv(`dm-logs_${range.from}_${range.to}.csv`, csv);
      const total: number = data.data.pagination?.total ?? rows.length;
      toast.success(
        total > rows.length
          ? `Exported the first ${rows.length} of ${total} rows`
          : `Exported ${rows.length} row${rows.length === 1 ? "" : "s"}`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const hasFilters =
    statusFilter !== "ALL" || selectedAccountId !== "all" || search !== "";

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <fieldset className="min-w-0">
            <legend className="field-label">Status</legend>
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((status) => (
                <button
                  key={status}
                  type="button"
                  aria-pressed={statusFilter === status}
                  onClick={() => resetPage(setStatusFilter)(status)}
                  className={`btn btn-sm ${statusFilter === status ? "btn-primary" : "btn-secondary"}`}
                >
                  {status === "ALL" ? "All" : status.replace("SKIPPED_", "").replace("_", " ")}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-end gap-3">
            {accounts.length > 1 && (
              <AccountSelect
                accounts={accounts}
                value={selectedAccountId}
                onChange={resetPage(setSelectedAccountId)}
              />
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void exportCsv()}
              disabled={exporting || loading}
            >
              <IconDownload size={16} />
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full lg:max-w-sm">
            <span className="sr-only">Search commenter or comment</span>
            <IconSearch
              size={16}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search commenter or comment…"
              className="input pl-8"
            />
          </label>
          <DateRangePicker value={range} onChange={resetPage(setRange)} />
        </div>
      </div>

      {/* Table */}
      <div className="table-wrap" aria-busy={loading}>
        <table className="table min-w-[960px]">
          <caption className="sr-only">
            DM logs{pagination ? `, ${pagination.total} total` : ""}
          </caption>
          <thead>
            <tr>
              <SortableTh col="createdAt" sort={sort} onToggle={toggleSort}>
                Date
              </SortableTh>
              <th scope="col">Commenter</th>
              <th scope="col">Comment</th>
              <SortableTh col="campaign" sort={sort} onToggle={toggleSort}>
                Campaign
              </SortableTh>
              <SortableTh col="account" sort={sort} onToggle={toggleSort}>
                Account
              </SortableTh>
              <SortableTh col="status" sort={sort} onToggle={toggleSort}>
                Status
              </SortableTh>
              <th scope="col">Public reply</th>
              <th scope="col">Error</th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              [...Array(5)].map((_, i) => (
                <tr key={i} aria-hidden="true">
                  <td colSpan={COLUMN_COUNT}>
                    <div className="h-4 rounded bg-surface-hover" />
                  </td>
                </tr>
              ))}
            {!loading && error && (
              <tr>
                <td colSpan={COLUMN_COUNT} className="py-12 text-center">
                  <p className="text-sm font-medium text-error">Couldn&apos;t load logs</p>
                  <p className="mt-1 text-sm text-muted">{error}</p>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm mt-3"
                    onClick={() => void fetchLogs()}
                  >
                    Retry
                  </button>
                </td>
              </tr>
            )}
            {!loading && !error && logs.length === 0 && (
              <tr>
                <td colSpan={COLUMN_COUNT} className="py-12 text-center text-sm text-muted">
                  {hasFilters ? (
                    <>
                      No logs match these filters.{" "}
                      <button
                        type="button"
                        className="text-accent hover:underline"
                        onClick={() => {
                          setStatusFilter("ALL");
                          setSelectedAccountId("all");
                          setSearchInput("");
                          setPage(1);
                        }}
                      >
                        Clear filters
                      </button>
                    </>
                  ) : (
                    <>
                      No DM activity in this range.{" "}
                      <Link href="/campaigns" className="text-accent hover:underline">
                        Set up a campaign
                      </Link>{" "}
                      or widen the date range.
                    </>
                  )}
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              logs.map((log) => (
                <tr key={log.id}>
                  <td className="whitespace-nowrap text-muted">{formatTime(log.createdAt)}</td>
                  <td className="whitespace-nowrap font-medium text-foreground">
                    @{log.commenterName ?? log.commenterId.slice(0, 8)}
                  </td>
                  <td className="max-w-[240px]">
                    <span className="block truncate text-muted" title={log.commentText}>
                      {log.commentText}
                    </span>
                  </td>
                  <td className="text-muted">{log.automation.name}</td>
                  <td className="whitespace-nowrap text-muted">@{log.instagramAccount.username}</td>
                  <td>
                    <StatusBadge status={log.status} />
                  </td>
                  <td>
                    {log.publicReplyError ? (
                      <span className="pill pill-warning" title={log.publicReplyError}>
                        Public reply failed
                      </span>
                    ) : log.publicReplySentAt ? (
                      <span className="pill pill-success">Replied</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="max-w-[260px]">
                    {log.errorMessage ? (
                      <span
                        className={`block truncate ${log.status === "FAILED" ? "text-error" : "text-muted"}`}
                        title={log.errorMessage}
                      >
                        {truncate(log.errorMessage, 80)}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>

        {/* Pagination */}
        {pagination && pagination.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-3">
            <p className="text-xs text-muted">
              Showing {(pagination.page - 1) * pagination.limit + 1}–
              {Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
              {pagination.total}
            </p>
            {pagination.totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage(page - 1)}
                  className="btn btn-secondary btn-sm"
                >
                  Previous
                </button>
                <span className="px-2 text-xs tabular-nums text-muted">
                  {page} / {pagination.totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= pagination.totalPages || loading}
                  onClick={() => setPage(page + 1)}
                  className="btn btn-secondary btn-sm"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
