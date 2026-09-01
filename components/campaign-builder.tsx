"use client";

/**
 * Campaign Builder
 *
 * Two-pane campaign editor: a control panel on the left and a live phone
 * preview on the right. Used for both creating and editing a campaign.
 *
 * Turn 1 wires the fully-functional pieces: trigger scope (specific / any /
 * next post), match mode (specific words / any word), the opening + reveal DM
 * text, public reply, and the tracked link. Button-driven delivery and the
 * follow / email / follow-up steps arrive in later turns.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import PostPicker from "@/components/post-picker";
import CampaignPreview, { type PreviewTab } from "@/components/campaign-preview";
import StatusBadge from "@/components/status-badge";
import { useToast } from "@/components/toast";
import { readCache, writeCache } from "@/lib/client-cache";
import {
  IMPORT_QUEUE_KEY,
  IMPORT_ACCOUNT_KEY,
  type ImportRow,
} from "@/lib/import-queue";

type TriggerScope = "specific" | "any" | "next";
type MatchMode = "specific" | "any";

/** Fields that get an inline `.field-error` under them. */
type FieldErrors = Partial<
  Record<
    | "name"
    | "postId"
    | "keywords"
    | "dmMessage"
    | "openingDm"
    | "trackedDestinationUrl"
    | "secondaryDestinationUrl",
    string
  >
>;

// Goal is free text on the API (max 120); these are the values the built-in
// templates use, offered as a select so reports stay consistent.
const GOAL_OPTIONS = [
  "Product link request",
  "Lead magnet delivery",
  "Launch waitlist",
  "Price or availability reply",
  "Agency client campaign",
] as const;

function isHttpUrl(value: string) {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// Server-side zod field names → the builder's inline error slots.
const SERVER_FIELD_MAP: Record<string, keyof FieldErrors> = {
  name: "name",
  postId: "postId",
  keywords: "keywords",
  dmMessage: "dmMessage",
  openingDmMessage: "openingDm",
  openingDmButtonLabel: "openingDm",
  trackedDestinationUrl: "trackedDestinationUrl",
  secondaryDestinationUrl: "secondaryDestinationUrl",
};

interface LoadedCampaign {
  id: string;
  name: string;
  goal: string | null;
  postId: string | null;
  postUrl: string | null;
  pendingNextReel: boolean;
  matchAnyPost: boolean;
  keywords: string[];
  matchAnyWord: boolean;
  wholeWordMatch?: boolean;
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
  instagramAccountId: string;
  trackedLinks?: { destinationUrl: string; label?: string | null }[];
}

interface CampaignBuilderProps {
  mode: "new" | "edit";
  campaignId?: string;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

/** A radio group with a visible legend; children are `Radio`s (and any
 * dependent inputs shown between them). */
function RadioGroup({
  title,
  error,
  children,
}: {
  title: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-semibold text-foreground">{title}</legend>
      <div className="mt-3 space-y-3">{children}</div>
      {error && <p className="field-error">{error}</p>}
    </fieldset>
  );
}

function Radio({
  name,
  value,
  checked,
  onSelect,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40 ${
        checked ? "border-accent bg-accent-soft" : "border-border hover:border-border-hover"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onSelect}
        className="h-4 w-4 shrink-0 accent-accent"
      />
      <span className="flex-1 text-foreground">{children}</span>
    </label>
  );
}

function Toggle({
  on,
  onToggle,
  label,
  labelledBy,
}: {
  on: boolean;
  onToggle: () => void;
  /** Accessible name when there is no visible label element to point at. */
  label?: string;
  /** id of the visible label element. */
  labelledBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-labelledby={labelledBy}
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
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

export default function CampaignBuilder({ mode, campaignId }: CampaignBuilderProps) {
  const router = useRouter();
  const toast = useToast();

  const [loading, setLoading] = useState(mode === "edit");
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [goal, setGoal] = useState("");
  const [wholeWordMatch, setWholeWordMatch] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [triggerScope, setTriggerScope] = useState<TriggerScope>("specific");
  const [postId, setPostId] = useState<string | null>(null);
  const [postUrl, setPostUrl] = useState<string | null>(null);
  const [postThumb, setPostThumb] = useState<string | null>(null);
  const [postCaption, setPostCaption] = useState("");

  // Post IDs already tied to another automation on this account, so the picker
  // can flag them and the user knows not to double-assign. Maps postId ->
  // the campaign name using it (for the tooltip).
  const [usedPosts, setUsedPosts] = useState<Record<string, string>>({});

  const [matchMode, setMatchMode] = useState<MatchMode>("specific");
  const [keywordText, setKeywordText] = useState("");
  const [dmTriggerEnabled, setDmTriggerEnabled] = useState(false);

  const [publicReplyEnabled, setPublicReplyEnabled] = useState(false);
  const [publicReplyMessages, setPublicReplyMessages] = useState<string[]>([""]);

  const [openingDmEnabled, setOpeningDmEnabled] = useState(false);
  const [openingDmMessage, setOpeningDmMessage] = useState("");
  const [openingDmButtonLabel, setOpeningDmButtonLabel] = useState("");

  const [dmMessage, setDmMessage] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [trackedDestinationUrl, setTrackedDestinationUrl] = useState("");
  const [linkButtonLabel, setLinkButtonLabel] = useState("Open link");
  const [secondLinkOpen, setSecondLinkOpen] = useState(false);
  const [secondaryDestinationUrl, setSecondaryDestinationUrl] = useState("");
  const [secondaryButtonLabel, setSecondaryButtonLabel] = useState("Open link");
  const [requireFollow, setRequireFollow] = useState(false);
  const [followPromptMessage, setFollowPromptMessage] = useState("");
  const [followPromptButtonLabel, setFollowPromptButtonLabel] =
    useState("i'm following");
  const [followUpEnabled, setFollowUpEnabled] = useState(false);
  const [followUpMessage, setFollowUpMessage] = useState("");
  const [followUpDelayMinutes, setFollowUpDelayMinutes] = useState(0);

  const [previewTab, setPreviewTab] = useState<PreviewTab>("dm");

  // CSV import queue. When present, each save advances to the next row instead
  // of returning to the campaigns list.
  const [importQueue, setImportQueue] = useState<ImportRow[] | null>(null);
  const [importTotal, setImportTotal] = useState(0);

  const keywords = useMemo(
    () =>
      keywordText
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    [keywordText]
  );

  // Fetch the connected account's real avatar for the preview (cache-first so
  // it shows instantly on a return visit instead of a blank circle).
  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    const cacheKey = `ig-avatar:${selectedAccountId}`;
    const cached = readCache<string | null>(cacheKey, 30 * 60 * 1000);
    // Hydrating state from cache is a legitimate effect use here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cached.data !== null) setAvatarUrl(cached.data);

    const params = new URLSearchParams({ instagramAccountId: selectedAccountId });
    fetch(`/api/instagram/profile?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const url = d.success ? d.data.profilePictureUrl ?? null : null;
        setAvatarUrl(url);
        writeCache(cacheKey, url);
      })
      .catch(() => {
        if (!cancelled && cached.data === null) setAvatarUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId]);

  // Load accounts (both modes need them for the preview username + selector).
  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return;
        const next: AccountOption[] = payload.data.instagramAccounts ?? [];
        setAccounts(next);
        setSelectedAccountId(
          (prev) => prev || payload.data.selectedInstagramAccountId || next[0]?.id || ""
        );
      })
      .catch(() => setAccounts([]));
  }, []);

  // Prefill when editing.
  useEffect(() => {
    if (mode !== "edit" || !campaignId) return;
    fetch("/api/automations", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return setNotFound(true);
        const c = (payload.data as LoadedCampaign[]).find((x) => x.id === campaignId);
        if (!c) return setNotFound(true);
        setName(c.name);
        setGoal(c.goal ?? "");
        setWholeWordMatch(c.wholeWordMatch ?? true);
        setSelectedAccountId(c.instagramAccountId);
        setTriggerScope(
          c.matchAnyPost ? "any" : c.pendingNextReel ? "next" : "specific"
        );
        setPostId(c.postId);
        setPostUrl(c.postUrl);
        setMatchMode(c.matchAnyWord ? "any" : "specific");
        setKeywordText(c.keywords.join(", "));
        setDmTriggerEnabled(c.dmTriggerEnabled ?? false);
        setPublicReplyEnabled(c.publicReplyEnabled);
        setPublicReplyMessages(
          c.publicReplyMessages?.length
            ? c.publicReplyMessages
            : c.publicReplyMessage
              ? [c.publicReplyMessage]
              : [""]
        );
        setOpeningDmEnabled(c.openingDmEnabled);
        setOpeningDmMessage(c.openingDmMessage ?? "");
        setOpeningDmButtonLabel(c.openingDmButtonLabel ?? "");
        setDmMessage(c.dmMessage);
        setLinkButtonLabel(c.linkButtonLabel ?? "Open link");
        setIsActive(c.isActive);
        const link = c.trackedLinks?.[0]?.destinationUrl ?? "";
        setTrackedDestinationUrl(link);
        setLinkOpen(Boolean(link));
        const secondLink = c.trackedLinks?.[1];
        setSecondaryDestinationUrl(secondLink?.destinationUrl ?? "");
        setSecondaryButtonLabel(secondLink?.label ?? "Open link");
        setSecondLinkOpen(Boolean(secondLink?.destinationUrl));
        setRequireFollow(c.requireFollow ?? false);
        setFollowPromptMessage(c.followPromptMessage ?? "");
        setFollowPromptButtonLabel(
          c.followPromptButtonLabel ?? "i'm following"
        );
        setFollowUpEnabled(c.followUpEnabled ?? false);
        setFollowUpMessage(c.followUpMessage ?? "");
        setFollowUpDelayMinutes(c.followUpDelayMinutes ?? 0);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [mode, campaignId]);

  // Track which posts on the selected account are already assigned to an
  // automation, so the picker can highlight them. The campaign being edited is
  // excluded — its own post should read as selected, not "taken".
  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    fetch("/api/automations", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (cancelled || !payload.success) return;
        const map: Record<string, string> = {};
        for (const a of payload.data as LoadedCampaign[]) {
          if (!a.postId) continue;
          if (a.instagramAccountId !== selectedAccountId) continue;
          if (mode === "edit" && a.id === campaignId) continue;
          map[a.postId] = a.name;
        }
        setUsedPosts(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId, mode, campaignId]);

  // Prefill the editable fields from one queued import row. The reel is left
  // unset so the user picks it per row.
  function prefillFromRow(row: ImportRow) {
    // Name is required; an unnamed CSV row gets a recognisable default.
    setName(row.name?.trim() || `Imported: ${row.keywords?.[0] ?? "campaign"}`);
    setGoal("");
    setWholeWordMatch(true);
    setFieldErrors({});
    setTriggerScope("specific");
    setPostId(null);
    setPostUrl(null);
    setPostThumb(null);
    setPostCaption("");
    setMatchMode("specific");
    setKeywordText((row.keywords ?? []).join(", "));
    setDmMessage(row.dmMessage ?? "");
    setPublicReplyEnabled(Boolean(row.publicReply));
    setPublicReplyMessages(row.publicReply ? [row.publicReply] : [""]);
    const hasOpening = Boolean(row.openingDmMessage);
    setOpeningDmEnabled(hasOpening);
    setOpeningDmMessage(row.openingDmMessage ?? "");
    setOpeningDmButtonLabel(
      row.openingDmButtonLabel || (hasOpening ? "Send link" : "")
    );
    const link = row.trackedUrl ?? "";
    setTrackedDestinationUrl(link);
    setLinkOpen(Boolean(link));
    setError(null);
  }

  // Pick up a staged CSV import (new mode only) and prefill the first row.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (mode !== "new") return;
    try {
      const raw = window.localStorage.getItem(IMPORT_QUEUE_KEY);
      const acct = window.localStorage.getItem(IMPORT_ACCOUNT_KEY);
      if (!raw) return;
      const queue = JSON.parse(raw) as ImportRow[];
      if (!Array.isArray(queue) || queue.length === 0) return;
      setImportQueue(queue);
      setImportTotal(queue.length);
      if (acct) setSelectedAccountId(acct);
      prefillFromRow(queue[0]);
    } catch {
      // ignore a malformed queue
    }
  }, [mode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const username =
    accounts.find((a) => a.id === selectedAccountId)?.username ?? "yourbrand";

  function handlePostSelect(
    id: string,
    url?: string,
    thumb?: string,
    caption?: string
  ) {
    setPostId(id);
    setPostUrl(url ?? null);
    setPostThumb(thumb ?? null);
    setPostCaption(caption ?? "");
  }

  function ensureLinkToken() {
    setDmMessage((cur) => (cur.includes("{link}") ? cur : `${cur.trim()} {link}`.trim()));
  }

  /** Client-side checks mirroring the API's zod rules, keyed by field. */
  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!name.trim()) errors.name = "Give the campaign a name.";
    if (triggerScope === "specific" && !postId)
      errors.postId = "Pick a post or reel to trigger the campaign.";
    if (matchMode === "specific" && keywords.length === 0)
      errors.keywords = "Add at least one keyword, or switch to any word.";
    if (!dmMessage.trim()) errors.dmMessage = "Add the DM with the link.";
    if (openingDmEnabled && (!openingDmMessage.trim() || !openingDmButtonLabel.trim()))
      errors.openingDm = "Your opening DM needs a message and a button label.";
    if (linkOpen && trackedDestinationUrl.trim() && !isHttpUrl(trackedDestinationUrl.trim()))
      errors.trackedDestinationUrl = "Enter a full URL starting with http:// or https://.";
    if (
      secondLinkOpen &&
      secondaryDestinationUrl.trim() &&
      !isHttpUrl(secondaryDestinationUrl.trim())
    )
      errors.secondaryDestinationUrl = "Enter a full URL starting with http:// or https://.";
    return errors;
  }

  function clearFieldError(field: keyof FieldErrors) {
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }

  async function handleSubmit(activeValue: boolean) {
    setError(null);

    if (!selectedAccountId) {
      setError("Connect an Instagram account first.");
      toast.error("Connect an Instagram account first");
      return;
    }
    const errors = validate();
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) {
      setError("Fix the highlighted fields to continue.");
      toast.error("Some fields need attention");
      if (typeof window !== "undefined")
        window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setSaving(true);

    const payload = {
      name: name.trim(),
      goal: goal.trim() || null,
      wholeWordMatch,
      instagramAccountId: selectedAccountId,
      postId: triggerScope === "specific" ? postId : null,
      postUrl: triggerScope === "specific" ? postUrl : null,
      matchAnyPost: triggerScope === "any",
      pendingNextReel: triggerScope === "next",
      matchAnyWord: matchMode === "any",
      keywords: matchMode === "any" ? [] : keywords,
      dmTriggerEnabled,
      dmMessage,
      openingDmEnabled,
      openingDmMessage: openingDmEnabled ? openingDmMessage : null,
      openingDmButtonLabel: openingDmEnabled ? openingDmButtonLabel : null,
      publicReplyEnabled,
      publicReplyMessages: publicReplyEnabled
        ? publicReplyMessages.map((m) => m.trim()).filter(Boolean)
        : [],
      trackedDestinationUrl: trackedDestinationUrl.trim() || "",
      linkButtonLabel: linkButtonLabel.trim() || "Open link",
      secondaryDestinationUrl: secondaryDestinationUrl.trim() || "",
      secondaryButtonLabel: secondaryButtonLabel.trim() || "Open link",
      requireFollow,
      followPromptMessage: requireFollow ? followPromptMessage.trim() : "",
      followPromptButtonLabel: requireFollow
        ? followPromptButtonLabel.trim() || "i'm following"
        : "",
      followUpEnabled,
      followUpMessage: followUpEnabled ? followUpMessage.trim() : "",
      followUpDelayMinutes: followUpEnabled ? followUpDelayMinutes : 0,
      isActive: activeValue,
    };

    try {
      const res =
        mode === "new"
          ? await fetch("/api/automations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await fetch(`/api/automations?id=${campaignId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
      const data = await res.json();
      if (res.ok && data.success) {
        if (importQueue) {
          toast.success(
            `Saved "${payload.name}" (${importTotal - importQueue.length + 1} of ${importTotal})`
          );
        } else {
          toast.success(mode === "new" ? "Campaign created" : "Campaign saved");
        }
        // The post we just assigned is now in use. Reflect it immediately so
        // the picker flags it on the next imported row — the fetch that builds
        // this map doesn't re-run while the builder stays mounted through the
        // import queue.
        if (triggerScope === "specific" && postId) {
          const assignedPostId = postId;
          setUsedPosts((prev) => ({ ...prev, [assignedPostId]: payload.name }));
        }
        // Importing: advance to the next queued row instead of leaving.
        if (importQueue && importQueue.length > 1) {
          const remaining = importQueue.slice(1);
          try {
            window.localStorage.setItem(
              IMPORT_QUEUE_KEY,
              JSON.stringify(remaining)
            );
          } catch {
            // ignore
          }
          setImportQueue(remaining);
          prefillFromRow(remaining[0]);
          setSaving(false);
          if (typeof window !== "undefined") window.scrollTo({ top: 0 });
          return;
        }
        if (importQueue) {
          try {
            window.localStorage.removeItem(IMPORT_QUEUE_KEY);
            window.localStorage.removeItem(IMPORT_ACCOUNT_KEY);
          } catch {
            // ignore
          }
        }
        // refresh() busts the router cache so the list reflects the save
        // instead of landing on a stale (empty) campaigns page.
        router.push("/campaigns");
        router.refresh();
      } else {
        // Surface the specific field that failed validation, inline under the
        // field and in the banner, instead of a generic "Invalid input".
        const serverErrors = data.details?.fieldErrors as
          | Record<string, string[]>
          | undefined;
        const mapped: FieldErrors = {};
        for (const [field, messages] of Object.entries(serverErrors ?? {})) {
          const slot = SERVER_FIELD_MAP[field];
          if (slot && messages[0]) mapped[slot] = messages[0];
        }
        setFieldErrors(mapped);
        const firstField = serverErrors && Object.keys(serverErrors)[0];
        const message = firstField
          ? `${firstField}: ${serverErrors[firstField][0]}`
          : data.error ?? "Failed to save campaign";
        setError(message);
        toast.error(message);
        if (typeof window !== "undefined")
          window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setError("Failed to save campaign");
      toast.error("Failed to save campaign — check your connection and try again");
    } finally {
      setSaving(false);
    }
  }

  // Skip the current imported row without saving a campaign for it, advancing
  // to the next one (or finishing the import if it was the last).
  function skipRow() {
    if (!importQueue) return;
    setError(null);
    if (importQueue.length > 1) {
      const remaining = importQueue.slice(1);
      try {
        window.localStorage.setItem(IMPORT_QUEUE_KEY, JSON.stringify(remaining));
      } catch {
        // ignore
      }
      setImportQueue(remaining);
      prefillFromRow(remaining[0]);
      if (typeof window !== "undefined") window.scrollTo({ top: 0 });
      return;
    }
    // Last row skipped — finish the import.
    try {
      window.localStorage.removeItem(IMPORT_QUEUE_KEY);
      window.localStorage.removeItem(IMPORT_ACCOUNT_KEY);
    } catch {
      // ignore
    }
    router.push("/campaigns");
    router.refresh();
  }

  if (loading) {
    return <div className="panel h-64 rounded" />;
  }

  if (notFound) {
    return (
      <div className="panel rounded p-8 text-center">
        <p className="text-sm text-muted">Campaign not found.</p>
        <button
          onClick={() => router.push("/campaigns")}
          className="btn btn-secondary mt-4"
        >
          Back to campaigns
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {importQueue && (
        <div className="rounded border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
          <span className="font-medium text-foreground">
            Importing {importTotal - importQueue.length + 1} of {importTotal}.
          </span>{" "}
          <span className="text-muted">
            Fields are prefilled from your CSV. Pick the reel, edit anything, and
            save to load the next one — or Skip if you don&rsquo;t want this one.
          </span>
        </div>
      )}

      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          {mode === "edit" ? (
            <>
              <span className="truncate text-sm font-semibold text-foreground">
                {name || "Untitled campaign"}
              </span>
              <StatusBadge status={isActive ? "ACTIVE" : "PAUSED"} />
            </>
          ) : (
            <span className="text-sm text-muted">New campaign</span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {importQueue && (
            <button
              type="button"
              onClick={skipRow}
              disabled={saving}
              className="btn btn-secondary"
            >
              {importQueue.length > 1 ? "Skip" : "Skip & finish"}
            </button>
          )}
          {mode === "edit" &&
            (isActive ? (
              <button
                type="button"
                onClick={() => handleSubmit(false)}
                disabled={saving}
                className="btn btn-secondary"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSubmit(true)}
                disabled={saving}
                className="btn btn-secondary"
              >
                Go Live
              </button>
            ))}
          <button
            type="button"
            onClick={() => handleSubmit(mode === "new" ? true : isActive)}
            disabled={saving}
            className="btn btn-primary"
          >
            {saving ? "Saving…" : mode === "new" ? "Go Live" : "Save changes"}
          </button>
        </div>
      </div>

      {/* min-w-0 on the cells: a grid item defaults to min-width:auto, so a
          long string widens the whole page instead of wrapping. */}
      <div className="grid gap-6 lg:grid-cols-[300px_1fr] lg:gap-8">
      {/* Left: controls */}
      <div className="space-y-8 min-w-0">
        {error && (
          <div
            role="alert"
            className="rounded-md border border-error/40 bg-error-soft p-3 text-sm text-error"
          >
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label htmlFor="campaign-name" className="text-sm font-semibold text-foreground">
              Campaign name
            </label>
            <input
              id="campaign-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clearFieldError("name");
              }}
              placeholder="e.g. YC referral"
              className="input mt-2"
              maxLength={100}
              required
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? "campaign-name-error" : undefined}
            />
            {fieldErrors.name && (
              <p id="campaign-name-error" className="field-error">
                {fieldErrors.name}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="campaign-goal" className="text-sm font-semibold text-foreground">
              Goal <span className="font-normal text-muted">(optional)</span>
            </label>
            <select
              id="campaign-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              className="input mt-2"
            >
              <option value="">No goal set</option>
              {(GOAL_OPTIONS.includes(goal as (typeof GOAL_OPTIONS)[number]) || !goal
                ? [...GOAL_OPTIONS]
                : [...GOAL_OPTIONS, goal]
              ).map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">
              Shown on the shared report to explain what the campaign is for.
            </p>
          </div>
          {accounts.length > 1 && (
            <div className="pt-2">
              <AccountSelect
                accounts={accounts}
                value={selectedAccountId}
                onChange={(id) => {
                  setSelectedAccountId(id);
                  setPostId(null);
                  setPostUrl(null);
                  setPostThumb(null);
                }}
                includeAll={false}
                label="Instagram account"
              />
            </div>
          )}
        </div>

        <RadioGroup title="When someone comments on" error={fieldErrors.postId}>
          <Radio
            name="triggerScope"
            value="specific"
            checked={triggerScope === "specific"}
            onSelect={() => {
              setTriggerScope("specific");
              clearFieldError("postId");
            }}
          >
            a specific post or reel
          </Radio>
          {triggerScope === "specific" && (
            <div className="rounded-lg border border-border p-2">
              <PostPicker
                selectedPostId={postId}
                instagramAccountId={selectedAccountId}
                usedPostIds={usedPosts}
                onSelect={(id, url, thumb, caption) => {
                  handlePostSelect(id, url, thumb, caption);
                  clearFieldError("postId");
                }}
              />
            </div>
          )}
          <Radio
            name="triggerScope"
            value="any"
            checked={triggerScope === "any"}
            onSelect={() => {
              setTriggerScope("any");
              clearFieldError("postId");
            }}
          >
            any post or reel
          </Radio>
          <Radio
            name="triggerScope"
            value="next"
            checked={triggerScope === "next"}
            onSelect={() => {
              setTriggerScope("next");
              clearFieldError("postId");
            }}
          >
            next post or reel
          </Radio>
        </RadioGroup>

        <RadioGroup title="And this comment has">
          <Radio
            name="matchMode"
            value="specific"
            checked={matchMode === "specific"}
            onSelect={() => setMatchMode("specific")}
          >
            a specific word or words
          </Radio>
          {matchMode === "specific" && (
            <div className="space-y-2">
              <div>
                <label htmlFor="campaign-keywords" className="sr-only">
                  Keywords
                </label>
                <input
                  id="campaign-keywords"
                  value={keywordText}
                  onChange={(e) => {
                    setKeywordText(e.target.value);
                    clearFieldError("keywords");
                  }}
                  placeholder="Enter a word or multiple"
                  className="input"
                  aria-invalid={Boolean(fieldErrors.keywords)}
                  aria-describedby={
                    fieldErrors.keywords ? "campaign-keywords-error" : "campaign-keywords-help"
                  }
                />
                {fieldErrors.keywords ? (
                  <p id="campaign-keywords-error" className="field-error">
                    {fieldErrors.keywords}
                  </p>
                ) : (
                  <p id="campaign-keywords-help" className="mt-1 text-xs text-muted">
                    Use commas to separate words
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                <div>
                  <span id="whole-word-label" className="text-sm text-foreground">
                    Whole words only
                  </span>
                  <p className="text-xs text-muted">
                    Match keywords as whole words only
                  </p>
                </div>
                <Toggle
                  on={wholeWordMatch}
                  onToggle={() => setWholeWordMatch((v) => !v)}
                  labelledBy="whole-word-label"
                />
              </div>
            </div>
          )}
          <Radio
            name="matchMode"
            value="any"
            checked={matchMode === "any"}
            onSelect={() => {
              setMatchMode("any");
              clearFieldError("keywords");
            }}
          >
            any word
          </Radio>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span id="dm-trigger-label" className="text-sm text-foreground">
              also reply when someone DMs{" "}
              {matchMode === "any" ? "anything" : "these words"}
            </span>
            <Toggle
              labelledBy="dm-trigger-label"
              on={dmTriggerEnabled}
              onToggle={() => setDmTriggerEnabled(!dmTriggerEnabled)}
            />
          </div>
          {dmTriggerEnabled && (
            <p className="text-xs text-muted">
              {matchMode === "any"
                ? "Every DM to this account gets the reply below — use with care."
                : "A DM containing any of these words gets the same reply, no comment needed."}
            </p>
          )}
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <span id="public-reply-label" className="text-sm text-foreground">
              reply to their comments under the post
            </span>
            <Toggle
              labelledBy="public-reply-label"
              on={publicReplyEnabled}
              onToggle={() => setPublicReplyEnabled(!publicReplyEnabled)}
            />
          </div>
          {publicReplyEnabled && (
            <div className="space-y-2">
              {publicReplyMessages.map((msg, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={msg}
                    onChange={(e) =>
                      setPublicReplyMessages((prev) =>
                        prev.map((m, idx) => (idx === i ? e.target.value : m))
                      )
                    }
                    placeholder="Sent you a DM! 📩"
                    maxLength={1000}
                    className="input"
                  />
                  {publicReplyMessages.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setPublicReplyMessages((prev) =>
                          prev.filter((_, idx) => idx !== i)
                        )
                      }
                      className="btn btn-ghost btn-icon shrink-0"
                      aria-label="Remove reply"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {publicReplyMessages.length < 10 && (
                <button
                  type="button"
                  onClick={() =>
                    setPublicReplyMessages((prev) => [...prev, ""])
                  }
                  className="text-xs font-medium text-accent hover:underline"
                >
                  + Add another reply
                </button>
              )}
              <p className="text-xs text-muted">
                One is picked at random each time, so replies don&apos;t look
                identical.
              </p>
            </div>
          )}
        </RadioGroup>

        <Section title="They will get">
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span id="opening-dm-label" className="text-sm text-foreground">an opening DM</span>
              <Toggle
                labelledBy="opening-dm-label"
                on={openingDmEnabled}
                onToggle={() => setOpeningDmEnabled(!openingDmEnabled)}
              />
            </div>
            {openingDmEnabled && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={openingDmMessage}
                  aria-label="Opening DM message"
                  aria-invalid={Boolean(fieldErrors.openingDm)}
                  onChange={(e) => {
                    setOpeningDmMessage(e.target.value);
                    clearFieldError("openingDm");
                  }}
                  placeholder="Hey there! I'm so happy you're here 😊"
                  rows={3}
                  className="input resize-none"
                  maxLength={1000}
                />
                <input
                  value={openingDmButtonLabel}
                  onChange={(e) => {
                    setOpeningDmButtonLabel(e.target.value);
                    clearFieldError("openingDm");
                  }}
                  placeholder="Send me the link"
                  className="input"
                  maxLength={64}
                  aria-label="Opening DM button label"
                  aria-invalid={Boolean(fieldErrors.openingDm)}
                />
                {fieldErrors.openingDm && (
                  <p className="field-error">{fieldErrors.openingDm}</p>
                )}
              </div>
            )}
          </div>
          <div className="mt-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span id="require-follow-label" className="text-sm text-foreground">
                a follow requirement first
              </span>
              <Toggle
                labelledBy="require-follow-label"
                on={requireFollow}
                onToggle={() => setRequireFollow(!requireFollow)}
              />
            </div>
            {requireFollow && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={followPromptMessage}
                  onChange={(e) => setFollowPromptMessage(e.target.value)}
                  placeholder="quick favor before i send your link. i don't make any money from this, it's free. if you want to support me, just don't unfollow after, and star the repo on github if it helps you. tap the button once you're following and i'll send it over"
                  rows={3}
                  className="input resize-none"
                  maxLength={1000}
                />
                <input
                  value={followPromptButtonLabel}
                  onChange={(e) => setFollowPromptButtonLabel(e.target.value)}
                  placeholder="i'm following"
                  className="input"
                  maxLength={20}
                />
                <p className="text-xs text-muted">
                  We send the link only after they tap the button and Instagram
                  confirms the follow. If it can&apos;t be verified, we send it
                  anyway.
                </p>
              </div>
            )}
          </div>
        </Section>

        <Section title="And then, they will get">
          <div className="rounded-lg border border-border p-3 space-y-2">
            <label htmlFor="campaign-dm" className="text-sm text-foreground">
              a DM with a link
            </label>
            <textarea
              id="campaign-dm"
              value={dmMessage}
              onChange={(e) => {
                setDmMessage(e.target.value);
                clearFieldError("dmMessage");
              }}
              placeholder="Write a message"
              rows={3}
              className="input resize-none"
              maxLength={1000}
              aria-invalid={Boolean(fieldErrors.dmMessage)}
              aria-describedby={fieldErrors.dmMessage ? "campaign-dm-error" : undefined}
            />
            {fieldErrors.dmMessage && (
              <p id="campaign-dm-error" className="field-error">
                {fieldErrors.dmMessage}
              </p>
            )}
            {linkOpen ? (
              <div className="space-y-2">
                <input
                  type="url"
                  inputMode="url"
                  value={trackedDestinationUrl}
                  onChange={(e) => {
                    setTrackedDestinationUrl(e.target.value);
                    clearFieldError("trackedDestinationUrl");
                  }}
                  onBlur={ensureLinkToken}
                  placeholder="https://yourlink.com/offer"
                  className="input"
                  aria-label="Destination URL"
                  aria-invalid={Boolean(fieldErrors.trackedDestinationUrl)}
                />
                {fieldErrors.trackedDestinationUrl && (
                  <p className="field-error">{fieldErrors.trackedDestinationUrl}</p>
                )}
                <input
                  value={linkButtonLabel}
                  onChange={(e) => setLinkButtonLabel(e.target.value)}
                  placeholder="Button label (e.g. Open link)"
                  maxLength={20}
                  className="input"
                />
                {secondLinkOpen ? (
                  <div className="space-y-2 border-t border-border pt-2">
                    <input
                      type="url"
                      inputMode="url"
                      value={secondaryDestinationUrl}
                      onChange={(e) => {
                        setSecondaryDestinationUrl(e.target.value);
                        clearFieldError("secondaryDestinationUrl");
                      }}
                      placeholder="https://yourlink.com/second"
                      className="input"
                      aria-label="Second destination URL"
                      aria-invalid={Boolean(fieldErrors.secondaryDestinationUrl)}
                    />
                    {fieldErrors.secondaryDestinationUrl && (
                      <p className="field-error">{fieldErrors.secondaryDestinationUrl}</p>
                    )}
                    <input
                      value={secondaryButtonLabel}
                      onChange={(e) => setSecondaryButtonLabel(e.target.value)}
                      placeholder="Second button label"
                      maxLength={20}
                      className="input"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSecondLinkOpen(true)}
                    className="btn btn-secondary w-full"
                  >
                    + Add A Second Link
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setLinkOpen(true)}
                className="btn btn-secondary w-full"
              >
                + Add A Link
              </button>
            )}
            <p className="text-xs text-muted">
              {"{link}"} inserts the tracked link; {"{username}"} personalizes.
            </p>
          </div>
          <div className="mt-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span id="follow-up-label" className="text-sm text-foreground">
                a follow-up thank-you message
              </span>
              <Toggle
                labelledBy="follow-up-label"
                on={followUpEnabled}
                onToggle={() => setFollowUpEnabled(!followUpEnabled)}
              />
            </div>
            {followUpEnabled && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={followUpMessage}
                  onChange={(e) => setFollowUpMessage(e.target.value)}
                  placeholder="Btw just wanted to say thanks for following me, I appreciate the support 🙌"
                  rows={3}
                  className="input resize-none"
                  maxLength={1000}
                />
                <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                  <span className="text-xs text-muted">Send it</span>
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={followUpDelayMinutes}
                    onChange={(e) =>
                      setFollowUpDelayMinutes(
                        Math.max(0, Math.min(1440, Math.floor(Number(e.target.value) || 0)))
                      )
                    }
                    className="input input-sm w-20"
                  />
                  <span className="text-xs text-muted">
                    minutes after the link
                  </span>
                </div>
                <p className="text-xs text-muted">
                  {followUpDelayMinutes > 0
                    ? `Sent ${followUpDelayMinutes} min after they tap through.`
                    : "Sent right after they tap through."}
                  {" {username}"} personalizes it. Max 24 hours, to stay inside
                  Instagram&apos;s messaging window.
                </p>
              </div>
            )}
          </div>
        </Section>
      </div>

      {/* Right: preview */}
      <div>
        <p className="mb-4 text-sm text-muted">Preview</p>
        <div className="flex min-w-0 justify-center lg:sticky lg:top-6 lg:block">
          <CampaignPreview
            tab={previewTab}
            onTabChange={setPreviewTab}
            username={username}
            avatarUrl={avatarUrl}
            postThumb={postThumb}
            caption={postCaption}
            sampleComment={keywords[0] ?? ""}
            dmTriggerEnabled={dmTriggerEnabled}
            publicReplyEnabled={publicReplyEnabled}
            publicReplyMessage={publicReplyMessages.find((m) => m.trim()) ?? ""}
            openingDmEnabled={openingDmEnabled}
            openingDmMessage={openingDmMessage}
            openingDmButtonLabel={openingDmButtonLabel}
            revealMessage={dmMessage}
            hasLink={Boolean(trackedDestinationUrl.trim())}
            linkButtonLabel={linkButtonLabel || "Open link"}
            linkUrl={trackedDestinationUrl.trim() || undefined}
            hasSecondLink={
              secondLinkOpen && Boolean(secondaryDestinationUrl.trim())
            }
            secondLinkButtonLabel={secondaryButtonLabel || "Open link"}
            requireFollow={requireFollow}
            followPromptMessage={followPromptMessage}
            followPromptButtonLabel={followPromptButtonLabel || "i'm following"}
            followUpEnabled={followUpEnabled}
            followUpMessage={followUpMessage}
            followUpDelayMinutes={followUpDelayMinutes}
          />
        </div>
      </div>
      </div>
    </div>
  );
}
