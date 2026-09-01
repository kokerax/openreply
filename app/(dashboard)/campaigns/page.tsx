"use client";

/**
 * Campaigns List Page
 *
 * Every campaign as a card with a live/paused switch, an actions menu, and a
 * multi-select bulk bar (pause / resume / delete). Search and status filter
 * are client-side over the loaded list.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import StatusBadge from "@/components/status-badge";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { IconAlert, IconMore, IconRefresh, IconSearch, IconX } from "@/components/icons";
import { readCache, writeCache } from "@/lib/client-cache";

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
  dmMessage: string;
  openingDmEnabled: boolean;
  openingDmMessage: string | null;
  openingDmButtonLabel: string | null;
  publicReplyEnabled: boolean;
  publicReplyMessage: string | null;
  publicReplyMessages: string[];
  requireFollow: boolean;
  followPromptMessage: string | null;
  followPromptButtonLabel: string | null;
  isActive: boolean;
  wholeWordMatch: boolean;
  instagramAccountId: string;
  instagramAccount: {
    username: string;
    instagramId: string;
  };
  reportShareSlug: string | null;
  reportShareEnabled: boolean;
  reportUrl: string | null;
  createdAt: string;
  _count: { dmLogs: number };
  trackedLinks: Array<{
    id: string;
    slug: string;
    label: string | null;
    destinationUrl: string;
    trackedUrl: string;
    _count: { clicks: number };
  }>;
  analytics: {
    sent: number;
    skipped: number;
    failed: number;
    clicks: number;
    ctr: number;
    topKeywords: { keyword: string; count: number }[];
  };
}

type BulkAction = "pause" | "resume" | "delete";

/** fetch + unwrap `{ success, data | error }`; throws with the API message. */
async function apiCall<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  let payload: { success?: boolean; error?: string; data?: T } = {};
  try {
    payload = await res.json();
  } catch {
    // Non-JSON body (proxy error page, network hiccup) — fall through to the
    // status-based error below.
  }
  if (!res.ok || !payload.success) {
    throw new Error(payload.error ?? `Request failed (${res.status})`);
  }
  return payload.data as T;
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

/* ------------------------------ primitives ------------------------------ */

function Switch({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        on ? "bg-accent" : "bg-border-hover"
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
          on ? "left-6" : "left-1"
        }`}
      />
    </button>
  );
}

interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * Keyboard-accessible actions menu: role=menu / menuitem, arrow keys move,
 * Home/End jump, Escape closes and returns focus to the trigger, outside click
 * closes.
 */
function ActionMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
      ?.focus();
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    const focusable = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled])'
      ) ?? []
    );
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case "ArrowDown":
        e.preventDefault();
        focusable[(current + 1) % focusable.length]?.focus();
        break;
      case "ArrowUp":
        e.preventDefault();
        focusable[(current - 1 + focusable.length) % focusable.length]?.focus();
        break;
      case "Home":
        e.preventDefault();
        focusable[0]?.focus();
        break;
      case "End":
        e.preventDefault();
        focusable[focusable.length - 1]?.focus();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    <div className="relative" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className="btn btn-ghost btn-icon"
      >
        <IconMore size={16} />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-surface-hover focus:bg-surface-hover focus:outline-none disabled:opacity-50 ${
                item.danger ? "text-error" : "text-foreground"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- page --------------------------------- */

export default function CampaignsPage() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [automations, setAutomations] = useState<Campaign[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // postId -> current thumbnail URL, fetched live (Instagram URLs expire, so
  // they are never stored on the campaign).
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  // postId -> video URL for reels, so a campaign thumbnail can play on click.
  const [videos, setVideos] = useState<Record<string, string>>({});
  // The reel currently playing in the lightbox (null when closed).
  const [playingVideo, setPlayingVideo] = useState<{
    url: string;
    postUrl: string | null;
  } | null>(null);
  const lightboxRef = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused">(
    "all"
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchAutomations = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedAccountId !== "all") {
        params.set("instagramAccountId", selectedAccountId);
      }
      const data = await apiCall<Campaign[]>(
        `/api/automations${params.size ? `?${params}` : ""}`,
        { cache: "no-store" }
      );
      setAutomations(data);
    } catch (err) {
      const message = errorMessage(err, "Failed to load campaigns");
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId, toast]);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((res) => res.json())
      .then((payload) => {
        if (payload.success) setAccounts(payload.data.instagramAccounts ?? []);
      })
      .catch(() => {
        // The account filter is a convenience; the list still loads without it.
        setAccounts([]);
      });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchAutomations();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchAutomations]);

  // Fetch fresh post thumbnails (and reel video URLs) for the accounts in view
  // and map them by postId. Cache-first so they show instantly on a return
  // visit. Instagram URLs expire, so they are never stored on the campaign.
  useEffect(() => {
    if (automations.length === 0) return;
    let cancelled = false;
    const accountIds = Array.from(
      new Set(automations.map((a) => a.instagramAccountId))
    ).sort();
    const cacheKey = `ig-media:${accountIds.join(",")}`;

    const cached = readCache<{
      thumbs: Record<string, string>;
      videos: Record<string, string>;
    }>(cacheKey, 15 * 60 * 1000);
    // Hydrating state from cache is a legitimate effect use here.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (cached.data) {
      setThumbnails(cached.data.thumbs);
      setVideos(cached.data.videos);
    }
    /* eslint-enable react-hooks/set-state-in-effect */

    Promise.all(
      accountIds.map((accountId) =>
        fetch(`/api/instagram/posts?instagramAccountId=${accountId}&limit=50`)
          .then((res) => res.json())
          .then((payload) =>
            payload.success
              ? (payload.data as {
                  id: string;
                  media_type?: string;
                  media_url?: string;
                  thumbnail_url?: string;
                }[])
              : []
          )
          .catch(() => [])
      )
    ).then((lists) => {
      if (cancelled) return;
      const thumbs: Record<string, string> = {};
      const vids: Record<string, string> = {};
      for (const list of lists) {
        for (const media of list) {
          const url = media.thumbnail_url ?? media.media_url;
          if (url) thumbs[media.id] = url;
          if (media.media_type === "VIDEO" && media.media_url) {
            vids[media.id] = media.media_url;
          }
        }
      }
      setThumbnails(thumbs);
      setVideos(vids);
      writeCache(cacheKey, { thumbs, videos: vids });
    });

    return () => {
      cancelled = true;
    };
  }, [automations]);

  // Native <dialog> lightbox: showModal() gives focus trapping and Escape.
  useEffect(() => {
    const dialog = lightboxRef.current;
    if (!dialog) return;
    if (playingVideo && !dialog.open) dialog.showModal();
    else if (!playingVideo && dialog.open) dialog.close();
  }, [playingVideo]);

  function handleAccountChange(accountId: string) {
    setLoading(true);
    setSelected(new Set());
    setSelectedAccountId(accountId);
  }

  function patchLocal(id: string, patch: Partial<Campaign>) {
    setAutomations((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...patch } : a))
    );
  }

  async function toggleActive(auto: Campaign) {
    const next = !auto.isActive;
    setBusyId(auto.id);
    try {
      await apiCall(`/api/automations?id=${auto.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      patchLocal(auto.id, { isActive: next });
      toast.success(`"${auto.name}" ${next ? "resumed" : "paused"}`);
    } catch (err) {
      toast.error(errorMessage(err, "Failed to update campaign"));
    } finally {
      setBusyId(null);
    }
  }

  async function toggleShare(auto: Campaign) {
    const enabled = !auto.reportShareEnabled;
    try {
      const data = await apiCall<{
        reportShareEnabled: boolean;
        reportShareSlug: string | null;
        reportUrl: string | null;
      }>(`/api/automations/${auto.id}/share`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      patchLocal(auto.id, data);
      toast.success(
        enabled ? "Report sharing turned on" : "Report sharing turned off"
      );
    } catch (err) {
      toast.error(errorMessage(err, "Failed to update report sharing"));
    }
  }

  async function copyText(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error(`Could not copy the ${what.toLowerCase()}`);
    }
  }

  async function deleteAutomation(auto: Campaign) {
    const ok = await confirm({
      title: `Delete "${auto.name}"?`,
      description:
        "The campaign, its DM history, and its tracked links are removed. This cannot be undone.",
      confirmLabel: "Delete campaign",
      danger: true,
    });
    if (!ok) return;
    try {
      await apiCall(`/api/automations?id=${auto.id}`, { method: "DELETE" });
      setAutomations((prev) => prev.filter((a) => a.id !== auto.id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(auto.id);
        return next;
      });
      toast.success(`"${auto.name}" deleted`);
    } catch (err) {
      toast.error(errorMessage(err, "Failed to delete campaign"));
    }
  }

  async function duplicateAutomation(auto: Campaign) {
    const specific = !auto.matchAnyPost && !auto.pendingNextReel;
    try {
      await apiCall("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${auto.name} copy`,
          goal: auto.goal,
          instagramAccountId: auto.instagramAccountId,
          postId: specific ? auto.postId : null,
          postUrl: specific ? auto.postUrl : null,
          matchAnyPost: auto.matchAnyPost,
          pendingNextReel: auto.pendingNextReel,
          matchAnyWord: auto.matchAnyWord,
          keywords: auto.keywords,
          dmMessage: auto.dmMessage,
          openingDmEnabled: auto.openingDmEnabled,
          openingDmMessage: auto.openingDmMessage,
          openingDmButtonLabel: auto.openingDmButtonLabel,
          publicReplyEnabled: auto.publicReplyEnabled,
          publicReplyMessages: auto.publicReplyMessages,
          trackedDestinationUrl: auto.trackedLinks[0]?.destinationUrl ?? "",
          secondaryDestinationUrl: auto.trackedLinks[1]?.destinationUrl ?? "",
          secondaryButtonLabel: auto.trackedLinks[1]?.label ?? "Open link",
          requireFollow: auto.requireFollow,
          followPromptMessage: auto.followPromptMessage,
          followPromptButtonLabel: auto.followPromptButtonLabel,
          wholeWordMatch: auto.wholeWordMatch,
          isActive: false,
        }),
      });
      toast.success(`Duplicated "${auto.name}" (paused)`);
      void fetchAutomations();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to duplicate campaign"));
    }
  }

  async function runBulk(action: BulkAction) {
    const ids = automations.filter((a) => selected.has(a.id)).map((a) => a.id);
    if (ids.length === 0) return;
    const noun = `${ids.length} campaign${ids.length === 1 ? "" : "s"}`;

    if (action === "delete") {
      const ok = await confirm({
        title: `Delete ${noun}?`,
        description:
          "Their DM history and tracked links are removed too. This cannot be undone.",
        confirmLabel: `Delete ${noun}`,
        danger: true,
      });
      if (!ok) return;
    }

    setBulkBusy(true);
    try {
      const data = await apiCall<{ action: BulkAction; count: number }>(
        "/api/automations/bulk",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, action }),
        }
      );
      const idSet = new Set(ids);
      if (action === "delete") {
        setAutomations((prev) => prev.filter((a) => !idSet.has(a.id)));
      } else {
        const isActive = action === "resume";
        setAutomations((prev) =>
          prev.map((a) => (idSet.has(a.id) ? { ...a, isActive } : a))
        );
      }
      setSelected(new Set());
      const verb =
        action === "delete" ? "deleted" : action === "pause" ? "paused" : "resumed";
      toast.success(`${data.count} campaign${data.count === 1 ? "" : "s"} ${verb}`);
    } catch (err) {
      toast.error(errorMessage(err, `Bulk ${action} failed`));
    } finally {
      setBulkBusy(false);
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const query = search.trim().toLowerCase();
  const filtered = automations.filter((a) => {
    if (statusFilter === "active" && !a.isActive) return false;
    if (statusFilter === "paused" && a.isActive) return false;
    if (!query) return true;
    return (
      a.name.toLowerCase().includes(query) ||
      a.keywords.some((k) => k.toLowerCase().includes(query)) ||
      a.dmMessage.toLowerCase().includes(query)
    );
  });
  const selectedCount = automations.filter((a) => selected.has(a.id)).length;
  const allShownSelected =
    filtered.length > 0 && filtered.every((a) => selected.has(a.id));

  function toggleSelectAllShown() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allShownSelected) filtered.forEach((a) => next.delete(a.id));
      else filtered.forEach((a) => next.add(a.id));
      return next;
    });
  }

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading campaigns">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="panel h-36 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error && automations.length === 0) {
    return (
      <div className="panel p-8 text-center" role="alert">
        <IconAlert className="mx-auto text-error" size={24} />
        <h3 className="mt-3 text-base font-semibold">Couldn&rsquo;t load campaigns</h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{error}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void fetchAutomations();
          }}
          className="btn btn-secondary mt-5"
        >
          <IconRefresh size={16} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted">
            {filtered.length}
            {filtered.length !== automations.length
              ? ` of ${automations.length}`
              : ""}{" "}
            campaign{automations.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {accounts.length > 1 && (
            <AccountSelect
              accounts={accounts}
              value={selectedAccountId}
              onChange={handleAccountChange}
            />
          )}
          <Link href="/campaigns/import" className="btn btn-secondary flex-1 sm:flex-none">
            Import
          </Link>
          <Link href="/campaigns/new" className="btn btn-primary flex-1 sm:flex-none">
            New Campaign
          </Link>
        </div>
      </div>

      {/* A refetch failed but we still have the previous list. */}
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-error/40 bg-error-soft px-3 py-2 text-sm text-error"
        >
          <IconAlert size={16} />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => void fetchAutomations()}
            className="btn btn-secondary btn-sm"
          >
            Retry
          </button>
        </div>
      )}

      {/* Search + status filter */}
      {automations.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative flex-1">
            <span className="sr-only">Search campaigns</span>
            <IconSearch
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search campaigns by name, keyword, or message…"
              className="input pl-9"
            />
          </label>
          <div
            role="group"
            aria-label="Filter by status"
            className="inline-flex shrink-0 rounded-md bg-surface p-1"
          >
            {(["all", "active", "paused"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={statusFilter === s}
                onClick={() => setStatusFilter(s)}
                className={`rounded px-3 py-1.5 text-sm capitalize transition-colors ${
                  statusFilter === s
                    ? "bg-background font-medium text-foreground ring-1 ring-accent/40"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Select-all + bulk bar */}
      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={allShownSelected}
              onChange={toggleSelectAllShown}
              className="h-4 w-4 accent-accent"
            />
            Select all shown
          </label>
          {selectedCount > 0 && (
            <div
              role="region"
              aria-label="Bulk actions"
              className="panel flex flex-1 flex-wrap items-center gap-2 px-3 py-2"
            >
              <span className="text-sm font-medium text-foreground">
                {selectedCount} selected
              </span>
              <button
                type="button"
                onClick={() => void runBulk("pause")}
                disabled={bulkBusy}
                className="btn btn-secondary btn-sm"
              >
                Pause
              </button>
              <button
                type="button"
                onClick={() => void runBulk("resume")}
                disabled={bulkBusy}
                className="btn btn-secondary btn-sm"
              >
                Resume
              </button>
              <button
                type="button"
                onClick={() => void runBulk("delete")}
                disabled={bulkBusy}
                className="btn btn-danger btn-sm"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                disabled={bulkBusy}
                className="btn btn-ghost btn-sm ml-auto"
              >
                <IconX size={14} /> Clear
              </button>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {automations.length === 0 && (
        <div className="panel p-8 text-center sm:p-12">
          <h3 className="mb-2 text-lg font-semibold">No campaigns yet</h3>
          <p className="mx-auto mb-6 max-w-sm text-sm text-muted">
            Create your first comment-to-DM campaign to turn a post or reel into a
            measurable conversation flow.
          </p>
          <Link href="/campaigns/new" className="btn btn-primary">
            Create Campaign
          </Link>
        </div>
      )}

      {/* No matches for the current filter */}
      {automations.length > 0 && filtered.length === 0 && (
        <div className="panel p-8 text-center text-sm text-muted">
          No campaigns match your search.{" "}
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setStatusFilter("all");
            }}
            className="text-accent hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Campaign cards */}
      <ul className="space-y-3">
        {filtered.map((auto) => {
          const videoUrl = auto.postId ? videos[auto.postId] : undefined;
          const isSelected = selected.has(auto.id);
          return (
            <li
              key={auto.id}
              onClick={(e) => {
                // Controls inside the card handle their own clicks.
                if ((e.target as HTMLElement).closest("a,button,input,label,[role=menu]"))
                  return;
                router.push(`/campaigns/${auto.id}`);
              }}
              className={`panel cursor-pointer p-4 transition-colors hover:border-border-hover ${
                isSelected ? "ring-1 ring-accent/40" : ""
              }`}
            >
              {/* Wraps rather than compressing: on a phone the action buttons drop
                  to their own line instead of squeezing the campaign summary. */}
              <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelected(auto.id)}
                  aria-label={`Select ${auto.name}`}
                  className="mt-1 h-4 w-4 shrink-0 accent-accent"
                />
                {auto.postId && thumbnails[auto.postId] && (
                  videoUrl ? (
                    <button
                      type="button"
                      onClick={() =>
                        setPlayingVideo({ url: videoUrl, postUrl: auto.postUrl })
                      }
                      aria-label="Play reel preview"
                      className="shrink-0"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbnails[auto.postId]}
                        alt="Campaign reel"
                        className="h-12 w-12 rounded border border-border object-cover hover:border-border-hover"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    </button>
                  ) : (
                    <a
                      href={auto.postUrl ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0"
                      aria-label="Open post on Instagram"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbnails[auto.postId]}
                        alt="Campaign post"
                        className="h-12 w-12 rounded border border-border object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    </a>
                  )
                )}
                <div className="min-w-[12rem] flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-semibold">
                      <Link
                        href={`/campaigns/${auto.id}`}
                        className="hover:text-accent"
                      >
                        {auto.name}
                      </Link>
                    </h3>
                    <span className="pill pill-muted">
                      @{auto.instagramAccount.username}
                    </span>
                    <StatusBadge status={auto.isActive ? "ACTIVE" : "PAUSED"} />
                    {auto.pendingNextReel && (
                      <span className="pill pill-warning">Waiting for next reel</span>
                    )}
                    {auto.requireFollow && (
                      <span className="pill pill-accent">Follow gate</span>
                    )}
                    {auto.trackedLinks.length >= 2 && (
                      <span className="pill pill-accent">2 links</span>
                    )}
                    {auto.reportShareEnabled && auto.reportUrl && (
                      <span className="pill pill-info">Report shared</span>
                    )}
                  </div>

                  {/* Keywords */}
                  {auto.keywords.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {auto.keywords.map((kw) => (
                        <span
                          key={kw}
                          className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* DM preview */}
                  <p className="truncate text-sm text-muted">
                    &ldquo;{auto.dmMessage}&rdquo;
                  </p>

                  {/* Tracked link sent */}
                  {auto.trackedLinks[0]?.trackedUrl && (
                    <p className="mt-2 truncate font-mono text-xs text-muted">
                      {auto.trackedLinks[0].trackedUrl}
                    </p>
                  )}

                  {/* Stats */}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
                    <span className="font-medium text-foreground">
                      {auto._count.dmLogs} runs
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-foreground">
                      {auto.analytics.ctr}% CTR
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{auto.analytics.sent} sent</span>
                    <span aria-hidden="true">·</span>
                    <span>{auto.analytics.skipped} skipped</span>
                    <span aria-hidden="true">·</span>
                    <span>{auto.analytics.failed} failed</span>
                    <span aria-hidden="true">·</span>
                    <span>{auto.analytics.clicks} clicks</span>
                  </div>

                  {auto.analytics.topKeywords.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {auto.analytics.topKeywords.map((keyword) => (
                        <span
                          key={keyword.keyword}
                          className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-muted"
                        >
                          {keyword.keyword}: {keyword.count}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="ml-auto flex items-center gap-2">
                  {auto.postUrl && (
                    <button
                      type="button"
                      onClick={() => void copyText(auto.postUrl!, "Reel URL")}
                      className="btn btn-ghost btn-sm"
                    >
                      Copy URL
                    </button>
                  )}
                  <Switch
                    on={auto.isActive}
                    onChange={() => void toggleActive(auto)}
                    label={`${auto.isActive ? "Pause" : "Resume"} ${auto.name}`}
                    disabled={busyId === auto.id}
                  />
                  <ActionMenu
                    label={`Actions for ${auto.name}`}
                    items={[
                      {
                        label: auto.reportShareEnabled
                          ? "Stop sharing report"
                          : "Share report",
                        onSelect: () => void toggleShare(auto),
                      },
                      {
                        label: "Copy report link",
                        disabled: !(auto.reportShareEnabled && auto.reportUrl),
                        onSelect: () =>
                          void copyText(auto.reportUrl ?? "", "Report link"),
                      },
                      {
                        label: "Duplicate",
                        onSelect: () => void duplicateAutomation(auto),
                      },
                      {
                        label: "Delete",
                        danger: true,
                        onSelect: () => void deleteAutomation(auto),
                      },
                    ]}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Reel lightbox */}
      <dialog
        ref={lightboxRef}
        aria-label="Reel preview"
        onClose={() => setPlayingVideo(null)}
        onClick={(e) => {
          if (e.target === lightboxRef.current) setPlayingVideo(null);
        }}
        className="m-auto w-[min(92vw,40rem)] rounded-lg border border-border bg-background p-0 text-foreground shadow-lg backdrop:bg-black/80"
      >
        {playingVideo && (
          <div className="flex flex-col gap-2 p-3">
            <div className="flex items-center justify-end gap-2 text-sm">
              {playingVideo.postUrl && (
                <a
                  href={playingVideo.postUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost btn-sm"
                >
                  Open on Instagram
                </a>
              )}
              <button
                type="button"
                onClick={() => setPlayingVideo(null)}
                className="btn btn-secondary btn-sm"
              >
                <IconX size={14} /> Close
              </button>
            </div>
            <video
              src={playingVideo.url}
              controls
              autoPlay
              loop
              playsInline
              className="max-h-[80vh] w-full rounded-md"
            />
          </div>
        )}
      </dialog>
    </div>
  );
}
