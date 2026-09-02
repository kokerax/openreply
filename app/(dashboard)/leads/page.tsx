"use client";

/**
 * Leads Page
 *
 * Every email address the campaign email gate collected: server-filtered,
 * server-sorted, paginated, with CSV export and a "copy all emails" button
 * that works on the whole filtered result, not just the visible page.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import DateRangePicker, {
  rangeForDays,
  rangeToParams,
  type DateRange,
} from "@/components/date-range-picker";
import { IconDownload, IconMail, IconSearch } from "@/components/icons";
import { SortableTh, type SortState } from "@/components/sortable-th";
import { useToast } from "@/components/toast";
import { downloadCsv, toCsv } from "@/lib/utils/csv";

interface Lead {
  id: string;
  igsid: string;
  username: string | null;
  email: string;
  sourceText: string | null;
  createdAt: string;
  automation: { id: string; name: string };
  instagramAccount: { username: string };
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface CampaignOption {
  id: string;
  name: string;
}

type SortCol = "createdAt" | "email" | "username" | "campaign";

const PAGE_SIZE = 50;
/** Same as the route's hard cap; a bigger result is reported as truncated. */
const BULK_LIMIT = 5000;
const SEARCH_DEBOUNCE_MS = 300;
const COLUMN_COUNT = 5;

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

export default function LeadsPage() {
  const toast = useToast();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);

  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  // Read once on mount so /leads?automationId=… (the campaign detail card's
  // link) lands pre-filtered. useSearchParams would force a Suspense boundary.
  const [automationId, setAutomationId] = useState("all");
  const [range, setRange] = useState<DateRange>(() => rangeForDays(30));
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState<SortCol>>({ col: "createdAt", dir: "desc" });
  const [page, setPage] = useState(1);
  const requestSeq = useRef(0);

  // Deferred a tick, like the fetch effect below: reading it during render
  // would disagree with the server-rendered markup, and setting state
  // synchronously in an effect body cascades a render.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const fromUrl = new URLSearchParams(window.location.search).get("automationId");
      if (fromUrl) setAutomationId(fromUrl);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

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
      if (automationId !== "all") params.set("automationId", automationId);
      if (search) params.set("search", search);
      for (const [k, v] of Object.entries(overrides)) params.set(k, v);
      return params;
    },
    [range, page, sort, automationId, search]
  );

  const fetchLeads = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads?${buildParams()}`);
      const data = await res.json();
      if (seq !== requestSeq.current) return; // a newer request superseded this one
      if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`);
      setLeads(data.data.leads);
      setPagination(data.data.pagination);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      const message = err instanceof Error ? err.message : "Failed to load leads";
      setError(message);
      toast.error(message);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [buildParams, toast]);

  useEffect(() => {
    fetch("/api/automations", { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => {
        if (!payload.success) return;
        setCampaigns(
          (payload.data as CampaignOption[]).map((a) => ({ id: a.id, name: a.name }))
        );
      })
      .catch(() => {
        // The campaign filter is a convenience; the table still loads without it.
        toast.info("Couldn't load the campaign filter");
      });
  }, [toast]);

  // Deferred a tick so the effect never sets state synchronously; the cleanup
  // also drops a fetch that a filter change superseded before it started.
  useEffect(() => {
    const t = window.setTimeout(() => void fetchLeads(), 0);
    return () => window.clearTimeout(t);
  }, [fetchLeads]);

  function toggleSort(col: SortCol) {
    setSort((s) =>
      s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "desc" }
    );
    setPage(1);
  }

  /** Pull the whole filtered result (up to the cap) for export / copy. */
  async function fetchAllFiltered(): Promise<{ rows: Lead[]; total: number }> {
    const res = await fetch(
      `/api/leads?${buildParams({ page: "1", limit: String(BULK_LIMIT) })}`
    );
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`);
    const rows: Lead[] = data.data.leads;
    return { rows, total: data.data.pagination?.total ?? rows.length };
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const { rows, total } = await fetchAllFiltered();
      if (rows.length === 0) {
        toast.info("Nothing to export for these filters");
        return;
      }
      const csv = toCsv(rows, [
        { header: "Date", value: (r) => r.createdAt },
        { header: "Email", value: (r) => r.email },
        { header: "Instagram user", value: (r) => r.username ?? r.igsid },
        { header: "Campaign", value: (r) => r.automation.name },
        { header: "Account", value: (r) => r.instagramAccount.username },
        { header: "Source text", value: (r) => r.sourceText },
      ]);
      downloadCsv(`leads_${range.from}_${range.to}.csv`, csv);
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

  async function copyAllEmails() {
    setCopying(true);
    try {
      const { rows, total } = await fetchAllFiltered();
      if (rows.length === 0) {
        toast.info("No emails to copy for these filters");
        return;
      }
      await navigator.clipboard.writeText(rows.map((r) => r.email).join("\n"));
      toast.success(
        total > rows.length
          ? `Copied the first ${rows.length} of ${total} emails`
          : `Copied ${rows.length} email${rows.length === 1 ? "" : "s"}`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Copy failed");
    } finally {
      setCopying(false);
    }
  }

  const hasFilters = automationId !== "all" || search !== "";
  const busy = loading || exporting || copying;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <label className="min-w-0">
            <span className="field-label">Campaign</span>
            <select
              value={automationId}
              onChange={(e) => {
                setAutomationId(e.target.value);
                setPage(1);
              }}
              className="input input-sm w-full sm:w-64"
            >
              <option value="all">All campaigns</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void copyAllEmails()}
              disabled={busy}
            >
              <IconMail size={16} />
              {copying ? "Copying…" : "Copy all emails"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void exportCsv()}
              disabled={busy}
            >
              <IconDownload size={16} />
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full lg:max-w-sm">
            <span className="sr-only">Search email or Instagram user</span>
            <IconSearch
              size={16}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search email or Instagram user…"
              className="input pl-8"
            />
          </label>
          <DateRangePicker
            value={range}
            onChange={(next) => {
              setRange(next);
              setPage(1);
            }}
          />
        </div>
      </div>

      {/* Table */}
      <div className="table-wrap" aria-busy={loading}>
        <table className="table min-w-[840px]">
          <caption className="sr-only">
            Collected email addresses{pagination ? `, ${pagination.total} total` : ""}
          </caption>
          <thead>
            <tr>
              <SortableTh col="createdAt" sort={sort} onToggle={toggleSort}>
                Date
              </SortableTh>
              <SortableTh col="email" sort={sort} onToggle={toggleSort}>
                Email
              </SortableTh>
              <SortableTh col="username" sort={sort} onToggle={toggleSort}>
                Instagram user
              </SortableTh>
              <SortableTh col="campaign" sort={sort} onToggle={toggleSort}>
                Campaign
              </SortableTh>
              <th scope="col">Source text</th>
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
                  <p className="text-sm font-medium text-error">Couldn&apos;t load leads</p>
                  <p className="mt-1 text-sm text-muted">{error}</p>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm mt-3"
                    onClick={() => void fetchLeads()}
                  >
                    Retry
                  </button>
                </td>
              </tr>
            )}
            {!loading && !error && leads.length === 0 && (
              <tr>
                <td colSpan={COLUMN_COUNT} className="py-12 text-center text-sm text-muted">
                  {hasFilters ? (
                    <>
                      No emails match these filters.{" "}
                      <button
                        type="button"
                        className="text-accent hover:underline"
                        onClick={() => {
                          setAutomationId("all");
                          setSearchInput("");
                          setPage(1);
                        }}
                      >
                        Clear filters
                      </button>
                    </>
                  ) : (
                    <>
                      No emails collected yet. Turn on{" "}
                      <span className="text-foreground">Email gate</span> in a campaign
                      and OpenReply will ask for an email before sending the link.{" "}
                      <Link href="/campaigns" className="text-accent hover:underline">
                        Open campaigns
                      </Link>{" "}
                      or widen the date range.
                    </>
                  )}
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              leads.map((lead) => (
                <tr key={lead.id}>
                  <td className="whitespace-nowrap text-muted">
                    {formatTime(lead.createdAt)}
                  </td>
                  <td className="whitespace-nowrap font-medium text-foreground">
                    {lead.email}
                  </td>
                  <td className="whitespace-nowrap text-muted">
                    @{lead.username ?? lead.igsid.slice(0, 8)}
                  </td>
                  <td className="text-muted">
                    <Link
                      href={`/campaigns/${lead.automation.id}`}
                      className="hover:text-foreground hover:underline"
                    >
                      {lead.automation.name}
                    </Link>
                  </td>
                  <td className="max-w-[280px]">
                    {lead.sourceText ? (
                      <span className="block truncate text-muted" title={lead.sourceText}>
                        {truncate(lead.sourceText, 80)}
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
