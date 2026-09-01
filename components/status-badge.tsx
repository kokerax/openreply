/**
 * Status pill. One place for every status the app shows.
 */

type Tone = "success" | "error" | "warning" | "info" | "muted" | "accent";

const statusConfig: Record<string, { tone: Tone; label: string }> = {
  // DmLog
  SENT: { tone: "success", label: "Sent" },
  FAILED: { tone: "error", label: "Failed" },
  PENDING: { tone: "warning", label: "Pending" },
  SKIPPED_DEDUP: { tone: "muted", label: "Dedup" },
  SKIPPED_RATE_LIMIT: { tone: "warning", label: "Rate limited" },
  SKIPPED_PLAN_LIMIT: { tone: "warning", label: "Skipped" },
  SKIPPED_NO_MATCH: { tone: "muted", label: "No match" },
  // Campaign
  ACTIVE: { tone: "success", label: "Active" },
  PAUSED: { tone: "muted", label: "Paused" },
  // Queue
  DONE: { tone: "success", label: "Done" },
  QUEUED: { tone: "info", label: "Queued" },
  RUNNING: { tone: "info", label: "Running" },
  // Invitations
  ACCEPTED: { tone: "success", label: "Accepted" },
  EXPIRED: { tone: "muted", label: "Expired" },
  REVOKED: { tone: "muted", label: "Revoked" },
  // Ops
  OPEN: { tone: "error", label: "Open" },
  RESOLVED: { tone: "success", label: "Resolved" },
};

interface StatusBadgeProps {
  status: string;
  /** Override the label while keeping the tone. */
  label?: string;
}

export default function StatusBadge({ status, label }: StatusBadgeProps) {
  const config = statusConfig[status] ?? { tone: "muted" as Tone, label: status };
  return (
    <span className={`pill pill-${config.tone}`}>{label ?? config.label}</span>
  );
}
