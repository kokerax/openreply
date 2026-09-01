"use client";

/**
 * Import Campaigns Page
 *
 * Paste or upload a CSV of everything except the post. Rows are previewed with
 * per-row validation; the valid ones are queued and opened in the campaign
 * builder prefilled and editable, one at a time, so you review each campaign
 * and pick its reel before saving.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { useToast } from "@/components/toast";
import { IconAlert } from "@/components/icons";
import { parseCsv } from "@/lib/utils/csv";
import {
  IMPORT_QUEUE_KEY,
  IMPORT_ACCOUNT_KEY,
  type ImportRow,
} from "@/lib/import-queue";

const SAMPLE = `keywords,dm_message,public_reply,tracked_url,opening_dm,opening_dm_button
"yc","here it is: {link}","sent. check dms","https://events.ycombinator.com/startup-school-2026","hey! click below for the referral","send link"
"LINK,SHOP","grab it here: {link}","dmed u",,,`;

const MAX_KEYWORDS = 10;

interface PreviewRow {
  index: number;
  row: ImportRow;
  errors: string[];
}

function isHttpUrl(value: string) {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Parse + validate every CSV row. Pure, so the preview re-renders as you type. */
function buildPreview(csv: string): PreviewRow[] {
  const parsed = parseCsv(csv);
  return parsed.map((r, i) => {
    const keywords = (r.keywords ?? "")
      .split(/[,;]/)
      .map((k) => k.trim())
      .filter(Boolean);
    const dmMessage = (r.dm_message ?? r.message ?? "").trim();
    const trackedUrl = (r.tracked_url ?? "").trim();
    const openingDmMessage = (r.opening_dm ?? "").trim();
    const openingDmButtonLabel = (r.opening_dm_button ?? "").trim();

    const errors: string[] = [];
    if (keywords.length === 0) errors.push("keywords is empty");
    if (keywords.length > MAX_KEYWORDS)
      errors.push(`more than ${MAX_KEYWORDS} keywords`);
    if (keywords.some((k) => k.length > 50)) errors.push("a keyword is over 50 characters");
    if (!dmMessage) errors.push("dm_message is empty");
    if (dmMessage.length > 1000) errors.push("dm_message is over 1000 characters");
    if (trackedUrl && !isHttpUrl(trackedUrl))
      errors.push("tracked_url must start with http:// or https://");
    if (openingDmMessage && !openingDmButtonLabel)
      errors.push("opening_dm needs an opening_dm_button");

    return {
      index: i + 1,
      errors,
      row: {
        name: (r.name ?? "").trim().slice(0, 100),
        keywords: keywords.slice(0, MAX_KEYWORDS),
        dmMessage,
        publicReply: (r.public_reply ?? "").trim(),
        trackedUrl,
        openingDmMessage,
        openingDmButtonLabel,
      },
    };
  });
}

export default function ImportCampaignsPage() {
  const router = useRouter();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staging, setStaging] = useState(false);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((res) => res.json())
      .then((payload) => {
        if (payload.success) {
          const next = payload.data.instagramAccounts ?? [];
          setAccounts(next);
          setSelectedAccountId(next[0]?.id ?? "");
        }
      })
      .catch(() => setAccounts([]));
  }, []);

  const preview = useMemo(() => buildPreview(csv), [csv]);
  const validRows = preview.filter((p) => p.errors.length === 0);
  const invalidRows = preview.filter((p) => p.errors.length > 0);

  function handleFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("CSV is over 2 MB — split it into smaller files");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setCsv(text);
      setFileName(file.name);
      setError(null);
      const rows = buildPreview(text);
      toast.success(
        `Loaded ${file.name}: ${rows.length} row${rows.length === 1 ? "" : "s"}`
      );
    };
    reader.onerror = () => toast.error(`Could not read ${file.name}`);
    reader.readAsText(file);
  }

  function startImport() {
    setError(null);
    if (preview.length === 0) {
      setError("Paste or upload a CSV with a header row and at least one campaign.");
      toast.error("Nothing to import yet");
      return;
    }
    if (validRows.length === 0) {
      setError("Every row has an error — fix the CSV and try again.");
      toast.error("No valid rows to import");
      return;
    }

    setStaging(true);
    for (const p of invalidRows) {
      toast.error(`Row ${p.index} skipped: ${p.errors.join("; ")}`);
    }

    try {
      window.localStorage.setItem(
        IMPORT_QUEUE_KEY,
        JSON.stringify(validRows.map((p) => p.row))
      );
      if (selectedAccountId) {
        window.localStorage.setItem(IMPORT_ACCOUNT_KEY, selectedAccountId);
      }
    } catch {
      setStaging(false);
      setError("Could not stage the import in this browser.");
      toast.error("Could not stage the import in this browser");
      return;
    }
    toast.success(
      `${validRows.length} row${validRows.length === 1 ? "" : "s"} ready — review each one in the builder`
    );
    router.push("/campaigns/new");
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Import campaigns</h1>
        <p className="mt-1 text-sm text-muted">
          Paste or upload a CSV with one row per campaign. Each row opens in the
          builder prefilled and editable, so you can review it and pick the reel
          before saving. Required columns are{" "}
          <code className="text-accent">keywords</code> and{" "}
          <code className="text-accent">dm_message</code>. Optional:{" "}
          <code className="text-accent">name</code>,{" "}
          <code className="text-accent">public_reply</code>,{" "}
          <code className="text-accent">tracked_url</code>,{" "}
          <code className="text-accent">opening_dm</code>,{" "}
          <code className="text-accent">opening_dm_button</code>. Keywords go in
          one cell, separated by commas. Use{" "}
          <code className="text-accent">{"{link}"}</code> in the message to
          insert the tracked link.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-error/40 bg-error-soft px-3 py-2 text-sm text-error"
        >
          <IconAlert size={16} />
          {error}
        </div>
      )}

      {accounts.length > 1 && (
        <AccountSelect
          accounts={accounts}
          value={selectedAccountId}
          onChange={setSelectedAccountId}
          includeAll={false}
          label="Instagram account"
        />
      )}

      <div className="space-y-2">
        <label htmlFor="import-file" className="field-label">
          Upload a CSV file
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            id="import-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              // Reset so picking the same file again re-fires onChange.
              e.target.value = "";
            }}
            className="text-sm text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-surface-hover"
          />
          {fileName && (
            <span className="pill pill-info">{fileName}</span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="import-csv" className="field-label">
          Or paste CSV
        </label>
        <textarea
          id="import-csv"
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setFileName(null);
          }}
          placeholder={SAMPLE}
          rows={8}
          className="input resize-y font-mono"
        />
        <button
          type="button"
          onClick={() => {
            setCsv(SAMPLE);
            setFileName(null);
          }}
          className="btn btn-ghost btn-sm"
        >
          Fill with a sample
        </button>
      </div>

      {/* Preview */}
      {preview.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              Preview · {preview.length} row{preview.length === 1 ? "" : "s"}
            </h2>
            <p className="text-xs text-muted">
              <span className="text-success">{validRows.length} ready</span>
              {invalidRows.length > 0 && (
                <>
                  {" · "}
                  <span className="text-error">{invalidRows.length} with errors</span>
                </>
              )}
            </p>
          </div>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">
                Parsed CSV rows with validation results
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="num">#</th>
                  <th scope="col">Name</th>
                  <th scope="col">Keywords</th>
                  <th scope="col">DM message</th>
                  <th scope="col">Link</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p) => (
                  <tr key={p.index}>
                    <td className="num tabular-nums text-muted">{p.index}</td>
                    <td className="max-w-[10rem] truncate">
                      {p.row.name || <span className="text-muted">—</span>}
                    </td>
                    <td>
                      <div className="flex max-w-[14rem] flex-wrap gap-1">
                        {p.row.keywords.length === 0 ? (
                          <span className="text-muted">—</span>
                        ) : (
                          p.row.keywords.map((k) => (
                            <span
                              key={k}
                              className="rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent"
                            >
                              {k}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="max-w-[16rem]">
                      <span className="line-clamp-2 break-words">
                        {p.row.dmMessage || <span className="text-muted">—</span>}
                      </span>
                    </td>
                    <td className="max-w-[12rem] truncate font-mono text-xs">
                      {p.row.trackedUrl || <span className="text-muted">—</span>}
                    </td>
                    <td>
                      {p.errors.length === 0 ? (
                        <span className="pill pill-success">Ready</span>
                      ) : (
                        <div className="space-y-1">
                          <span className="pill pill-error">Error</span>
                          <ul className="text-xs text-error">
                            {p.errors.map((e) => (
                              <li key={e}>{e}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={startImport}
          disabled={staging || validRows.length === 0}
          className="btn btn-primary"
        >
          {staging
            ? "Opening builder…"
            : validRows.length > 0
              ? `Review and import ${validRows.length} row${validRows.length === 1 ? "" : "s"}`
              : "Review and import"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/campaigns")}
          className="btn btn-secondary"
        >
          Cancel
        </button>
        {invalidRows.length > 0 && validRows.length > 0 && (
          <p className="text-xs text-muted">
            Rows with errors are skipped.
          </p>
        )}
      </div>
    </div>
  );
}
