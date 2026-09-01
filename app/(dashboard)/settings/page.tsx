"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import type { AccountOption } from "@/components/account-select";
import { InstagramConnectNotice } from "@/components/instagram-connect-notice";
import StatusBadge from "@/components/status-badge";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { IconRefresh } from "@/components/icons";

type Role = "OWNER" | "ADMIN" | "MEMBER";
type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

interface SettingsData {
  workspace: {
    name: string;
    dmsSentThisPeriod: number;
  };
  instagramAccounts: Array<
    AccountOption & {
      tokenExpiresAt: string | null;
      webhookSubscribed: boolean;
    }
  >;
}

interface WorkspaceMembersData {
  currentUserRole: Role;
  currentUserId: string;
  members: Array<{
    id: string;
    role: Role;
    createdAt: string;
    user: {
      id: string;
      email: string | null;
      name: string | null;
    };
  }>;
  invitations: Array<{
    id: string;
    email: string;
    role: Role;
    status: InvitationStatus;
    inviteUrl: string | null;
    expiresAt: string;
    acceptedAt: string | null;
    createdAt: string;
  }>;
  usage: {
    dmsSentThisPeriod: number;
    periodStart: string | null;
    limit: number;
    remaining: number;
  };
}

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: "OWNER", label: "Owner" },
  { value: "ADMIN", label: "Admin" },
  { value: "MEMBER", label: "Member" },
];

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

async function readJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return { success: false, error: `Request failed (${res.status})` };
  }
}

export default function SettingsPage() {
  const toast = useToast();
  const confirm = useConfirm();

  const [data, setData] = useState<SettingsData | null>(null);
  const [membersData, setMembersData] = useState<WorkspaceMembersData | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [memberError, setMemberError] = useState<string | null>(null);

  // `loading` starts true; Retry re-arms it via reload() rather than inside
  // the effect, which the react-hooks lint rule (rightly) rejects.
  const load = useCallback(async () => {
    try {
      const [statsRes, membersRes] = await Promise.all([
        fetch("/api/dashboard/stats", { cache: "no-store" }),
        fetch("/api/workspace/members", { cache: "no-store" }),
      ]);
      const [statsPayload, membersPayload] = await Promise.all([
        readJson(statsRes),
        readJson(membersRes),
      ]);
      if (!statsPayload.success) {
        throw new Error(statsPayload.error ?? "Could not load Instagram settings");
      }
      if (!membersPayload.success) {
        throw new Error(membersPayload.error ?? "Could not load team");
      }
      setData(statsPayload.data);
      setMembersData(membersPayload.data);
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not load settings";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
    // toast is stable (memoized in the provider)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // load() only touches state after its first await; the lint rule cannot
    // see the async boundary. Same pattern as the inbox page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function reload() {
    setLoading(true);
    setError(null);
    void load();
  }

  async function refreshMembers(): Promise<boolean> {
    try {
      const payload = await readJson(
        await fetch("/api/workspace/members", { cache: "no-store" })
      );
      if (!payload.success) throw new Error(payload.error ?? "Could not refresh team");
      setMembersData(payload.data);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not refresh team");
      return false;
    }
  }

  async function disconnectInstagram(account: SettingsData["instagramAccounts"][number]) {
    const ok = await confirm({
      title: `Disconnect @${account.username}?`,
      description:
        "Campaigns for this account will stop sending DMs until it is reconnected.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;

    setBusy(`disconnect:${account.id}`);
    try {
      const payload = await readJson(
        await fetch("/api/instagram/disconnect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instagramAccountId: account.id }),
        })
      );
      if (!payload.success) throw new Error(payload.error ?? "Could not disconnect");
      toast.success(`Disconnected @${account.username}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not disconnect");
    } finally {
      setBusy(null);
    }
  }

  async function inviteMember(event: React.FormEvent) {
    event.preventDefault();
    setMemberError(null);
    setBusy("invite");
    try {
      const payload = await readJson(
        await fetch("/api/workspace/members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
        })
      );
      if (!payload.success) throw new Error(payload.error ?? "Could not invite member");
      setMembersData(payload.data);
      setInviteEmail("");
      toast.success(`Invitation sent to ${inviteEmail}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not invite member";
      setMemberError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  }

  async function copyInviteLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Invite link copied");
    } catch {
      toast.error("Could not copy — select the link and copy it manually");
    }
  }

  async function revokeInvitation(invitation: WorkspaceMembersData["invitations"][number]) {
    const ok = await confirm({
      title: `Revoke invitation for ${invitation.email}?`,
      description: "The invite link will stop working immediately.",
      confirmLabel: "Revoke",
      danger: true,
    });
    if (!ok) return;

    setBusy(`invite:${invitation.id}`);
    try {
      const payload = await readJson(
        await fetch("/api/workspace/members", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invitationId: invitation.id }),
        })
      );
      if (!payload.success) throw new Error(payload.error ?? "Could not revoke invitation");
      setMembersData(payload.data);
      toast.success("Invitation revoked");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not revoke invitation");
    } finally {
      setBusy(null);
    }
  }

  async function changeRole(
    member: WorkspaceMembersData["members"][number],
    role: Role
  ) {
    if (role === member.role) return;
    const label = member.user.name ?? member.user.email ?? "this member";
    if (role === "OWNER" || member.role === "OWNER") {
      const ok = await confirm({
        title:
          role === "OWNER"
            ? `Make ${label} an owner?`
            : `Remove owner rights from ${label}?`,
        description:
          role === "OWNER"
            ? "Owners can change every role, remove any member and manage billing."
            : `They will become ${role === "ADMIN" ? "an admin" : "a member"}.`,
        confirmLabel: "Change role",
        danger: member.role === "OWNER",
      });
      if (!ok) return;
    }

    setBusy(`role:${member.id}`);
    try {
      const payload = await readJson(
        await fetch(`/api/workspace/members/${member.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        })
      );
      if (!payload.success) throw new Error(payload.error ?? "Could not change role");
      toast.success(`${label} is now ${role.toLowerCase()}`);
      await refreshMembers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change role");
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(member: WorkspaceMembersData["members"][number]) {
    const isSelf = member.user.id === membersData?.currentUserId;
    const label = member.user.name ?? member.user.email ?? "this member";
    const ok = await confirm({
      title: isSelf ? "Leave this workspace?" : `Remove ${label}?`,
      description: isSelf
        ? "You will lose access to its campaigns, inbox and settings."
        : "They will lose access immediately. You can invite them again later.",
      confirmLabel: isSelf ? "Leave" : "Remove",
      danger: true,
    });
    if (!ok) return;

    setBusy(`remove:${member.id}`);
    try {
      const payload = await readJson(
        await fetch(`/api/workspace/members/${member.id}`, { method: "DELETE" })
      );
      if (!payload.success) throw new Error(payload.error ?? "Could not remove member");
      if (payload.data?.self) {
        toast.success("You left the workspace");
        window.location.assign("/");
        return;
      }
      toast.success(`Removed ${label}`);
      await refreshMembers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove member");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-8" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="panel p-4 sm:p-6">
            <div className="h-4 w-40 rounded bg-surface-hover" />
            <div className="mt-6 h-12 rounded bg-surface-hover" />
            <div className="mt-3 h-12 rounded bg-surface-hover" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !data || !membersData) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="panel p-8 text-center">
          <p className="text-sm text-error">{error ?? "Could not load settings"}</p>
          <button
            type="button"
            onClick={reload}
            className="btn btn-secondary mt-4"
          >
            <IconRefresh size={16} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  const accounts = data.instagramAccounts ?? [];
  const role = membersData.currentUserRole;
  const canManageMembers = role === "OWNER" || role === "ADMIN";
  const ownerCount = membersData.members.filter((m) => m.role === "OWNER").length;
  const usage = membersData.usage;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Surfaces the ?instagram= code the OAuth routes redirect back with.
          Needs a Suspense boundary: useSearchParams in a prerendered client
          page fails the production build without one. */}
      <Suspense fallback={null}>
        <InstagramConnectNotice />
      </Suspense>

      <section className="panel p-4 sm:p-6">
        <h2 className="section-title mb-6">Instagram Connection</h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 border-b border-border py-3">
            <div>
              <p className="text-sm font-medium text-foreground">Status</p>
              <p className="mt-0.5 text-xs text-muted">
                Comment webhooks and private replies depend on this connection.
              </p>
            </div>
            {accounts.length > 0 ? (
              <StatusBadge status="ACTIVE" label="Connected" />
            ) : (
              <StatusBadge status="PENDING" label="Not connected" />
            )}
          </div>

          <div className="space-y-3 py-3">
            {accounts.length === 0 && (
              <p className="text-sm text-muted">
                Connect an Instagram professional account to launch campaigns.
              </p>
            )}
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex flex-col gap-3 rounded-md border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    @{account.username}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>
                      Token expires{" "}
                      {account.tokenExpiresAt
                        ? formatDate(account.tokenExpiresAt)
                        : "not available"}
                    </span>
                    {account.webhookSubscribed ? (
                      <StatusBadge status="ACTIVE" label="Webhook ready" />
                    ) : (
                      <StatusBadge status="PENDING" label="Webhook pending" />
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void disconnectInstagram(account)}
                  disabled={busy === `disconnect:${account.id}`}
                  className="btn btn-danger btn-sm"
                >
                  {busy === `disconnect:${account.id}`
                    ? "Disconnecting…"
                    : "Disconnect"}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 flex gap-3 border-t border-border pt-4">
          <a href="/api/instagram/connect" className="btn btn-primary">
            {accounts.length > 0 ? "Connect another account" : "Connect Instagram"}
          </a>
        </div>
      </section>

      <section className="panel p-4 sm:p-6">
        <h2 className="section-title mb-1">Team</h2>
        <p className="mb-5 text-xs text-muted">
          Owners can change any role; admins can manage members and invites;
          members can use the workspace. A workspace always keeps at least one
          owner.
        </p>

        <ul className="divide-y divide-border">
          {membersData.members.map((member) => {
            const isSelf = member.user.id === membersData.currentUserId;
            const isLastOwner = member.role === "OWNER" && ownerCount <= 1;
            // Mirrors lib/workspace-access rules so the UI does not offer
            // actions the API will refuse; the API still enforces them.
            const canEditRole =
              canManageMembers &&
              (role === "OWNER" || member.role !== "OWNER");
            const canRemove =
              (isSelf ||
                (canManageMembers &&
                  (role === "OWNER" || member.role !== "OWNER"))) &&
              !isLastOwner;
            const roleBusy = busy === `role:${member.id}`;
            const removeBusy = busy === `remove:${member.id}`;

            return (
              <li
                key={member.id}
                className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {member.user.name ?? member.user.email ?? "Unknown member"}
                    {isSelf && (
                      <span className="ml-2 text-xs font-normal text-muted">
                        (you)
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {member.user.email} · joined {formatDate(member.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {canEditRole ? (
                    <label className="flex items-center gap-2 text-xs text-muted">
                      <span className="sr-only">
                        Role for {member.user.email}
                      </span>
                      <select
                        value={member.role}
                        disabled={roleBusy || isLastOwner}
                        title={
                          isLastOwner
                            ? "The last owner cannot be demoted"
                            : undefined
                        }
                        onChange={(event) =>
                          void changeRole(member, event.target.value as Role)
                        }
                        className="input input-sm w-auto"
                      >
                        {ROLE_OPTIONS.filter(
                          (o) => role === "OWNER" || o.value !== "OWNER"
                        ).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <span className="pill pill-muted">
                      {ROLE_OPTIONS.find((o) => o.value === member.role)?.label}
                    </span>
                  )}
                  {canRemove && (
                    <button
                      type="button"
                      onClick={() => void removeMember(member)}
                      disabled={removeBusy}
                      className="btn btn-danger btn-sm"
                    >
                      {removeBusy ? "Removing…" : isSelf ? "Leave" : "Remove"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {membersData.invitations.length > 0 && (
          <div className="mt-6 border-t border-border pt-4">
            <p className="field-label">Invitations</p>
            <ul className="space-y-3">
              {membersData.invitations.map((invitation) => {
                const pending = invitation.status === "PENDING";
                const inviteBusy = busy === `invite:${invitation.id}`;
                return (
                  <li
                    key={invitation.id}
                    className="flex flex-col gap-3 rounded-md border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                        <span className="truncate">{invitation.email}</span>
                        <StatusBadge status={invitation.status} />
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {ROLE_OPTIONS.find((o) => o.value === invitation.role)?.label}
                        {" · "}
                        {invitation.status === "ACCEPTED"
                          ? `accepted ${formatDate(invitation.acceptedAt)}`
                          : invitation.status === "EXPIRED"
                            ? `expired ${formatDate(invitation.expiresAt)}`
                            : invitation.status === "REVOKED"
                              ? `revoked · sent ${formatDate(invitation.createdAt)}`
                              : `expires ${formatDate(invitation.expiresAt)}`}
                      </p>
                      {pending && invitation.inviteUrl && (
                        <p className="mt-1 truncate text-xs text-muted">
                          {invitation.inviteUrl}
                        </p>
                      )}
                    </div>
                    {pending && canManageMembers && (
                      <div className="flex shrink-0 gap-2">
                        {invitation.inviteUrl && (
                          <button
                            type="button"
                            onClick={() => void copyInviteLink(invitation.inviteUrl!)}
                            className="btn btn-secondary btn-sm"
                          >
                            Copy link
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void revokeInvitation(invitation)}
                          disabled={inviteBusy}
                          className="btn btn-danger btn-sm"
                        >
                          {inviteBusy ? "Revoking…" : "Revoke"}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {canManageMembers && (
          <form
            onSubmit={inviteMember}
            className="mt-6 grid gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_140px_auto]"
          >
            <label className="sr-only" htmlFor="invite-email">
              Email to invite
            </label>
            <input
              id="invite-email"
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="teammate@agency.com"
              className="input"
              required
            />
            <label className="sr-only" htmlFor="invite-role">
              Role
            </label>
            <select
              id="invite-role"
              value={inviteRole}
              onChange={(event) =>
                setInviteRole(event.target.value as "ADMIN" | "MEMBER")
              }
              className="input"
            >
              <option value="MEMBER">Member</option>
              <option value="ADMIN">Admin</option>
            </select>
            <button
              type="submit"
              disabled={busy === "invite"}
              className="btn btn-primary"
            >
              {busy === "invite" ? "Inviting…" : "Invite"}
            </button>
            {memberError && (
              <p className="field-error sm:col-span-3">{memberError}</p>
            )}
          </form>
        )}
      </section>

      <section className="panel p-4 sm:p-6">
        <h2 className="section-title mb-6">Usage</h2>
        <div className="flex items-center justify-between gap-3 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              DMs sent this period
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {usage.periodStart
                ? `Counting since ${formatDate(usage.periodStart)}; resets monthly.`
                : "Counting since the workspace was created; resets monthly."}{" "}
              Self-hosted — no plan cap is enforced; Instagram&apos;s own
              messaging limits still apply.
            </p>
          </div>
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {usage.dmsSentThisPeriod.toLocaleString()}
          </span>
        </div>
      </section>
    </div>
  );
}
