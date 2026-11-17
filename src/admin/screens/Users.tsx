/**
 * Users — account directory (GET /api/admin/users), administrative role
 * assignment, MFA reset, and invitations.
 *
 * Role changes, invitation creation and MFA resets are step-up actions
 * on the server: they need an MFA verification from the last 15 minutes.
 * A fresh sign-in satisfies that; when it lapses the server answers 403
 * and the screen opens the in-place step-up modal instead — a fresh TOTP
 * code re-stamps the session and the parked action retries once, so the
 * admin never has to sign out and back in (Phase 4 review fix).
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { KeyRound, MailPlus } from "lucide-react";
import { ApiError, authApi, usersApi } from "../api";
import { useAuth } from "../AdminApp";
import type { AdminUser, Invitation, RoleInfo } from "../types";
import { Badge, Btn, ConfirmDialog, ErrorBox, Field, Notice, Spinner, StepUpModal, formatDateTime, inputCls } from "../ui";

/** True when the server refused an action for a stale step-up stamp. */
function isStepUpError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 403 &&
    err.message.includes("recent MFA verification")
  );
}

const ASSIGNABLE_ROLES = ["SUPER_ADMIN", "ADMIN", "STORE_ADMIN", "CUSTOMER"];
const INVITABLE_ROLES = ["SUPER_ADMIN", "ADMIN", "STORE_ADMIN"];
const ADMIN_ROLES = new Set(["SUPER_ADMIN", "ADMIN", "STORE_ADMIN"]);

function primaryRole(user: AdminUser): string {
  for (const role of ASSIGNABLE_ROLES) {
    if (user.roles.includes(role)) return role;
  }
  return "CUSTOMER";
}

export default function UsersScreen() {
  const { user: me, hasPermission } = useAuth();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [roleTarget, setRoleTarget] = useState<{ user: AdminUser; role: string } | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [busy, setBusy] = useState(false);
  // The step-up-gated action parked while the step-up modal verifies a
  // fresh TOTP code; retried exactly once on success.
  const [stepUpRetry, setStepUpRetry] = useState<{ run: () => Promise<void> } | null>(null);

  const load = useCallback(async () => {
    try {
      const [userData, roleData, invitationData] = await Promise.all([
        usersApi.list(1, 100),
        usersApi.roles(),
        usersApi.listInvitations(1, 100),
      ]);
      setUsers(userData.items);
      setRoles(roleData.items);
      setInvitations(invitationData.items);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Run a step-up-gated action. If the server refuses because the last
   * MFA verification aged out of the step-up window, park the action and
   * open the step-up modal rather than surfacing the raw 403; any other
   * error is shown as before.
   */
  const runSensitive = async (run: () => Promise<void>): Promise<void> => {
    try {
      await run();
    } catch (err) {
      if (isStepUpError(err)) {
        setStepUpRetry({ run });
      } else {
        setError(err);
      }
    }
  };

  const confirmRole = async () => {
    if (!roleTarget) return;
    const target = roleTarget;
    setBusy(true);
    setError(null);
    setRoleTarget(null);
    try {
      await runSensitive(async () => {
        const result = await usersApi.assignRole(target.user.id, target.role);
        setNotice(result.message);
        await load();
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmReset = async () => {
    if (!resetTarget) return;
    const target = resetTarget;
    setBusy(true);
    setError(null);
    setResetTarget(null);
    try {
      await runSensitive(async () => {
        const result = await authApi.resetMfa(target.id);
        setNotice(result.message);
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="font-display text-3xl tracking-wide">Users</h1>
        <p className="text-sm text-muted-foreground">
          Accounts, administrative roles and invitations. Sensitive actions need a recent two-factor verification —
          if yours has lapsed, you will be asked for a fresh code in place, with no need to sign out.
        </p>
      </div>

      <ErrorBox error={error} />
      {notice && <Notice>{notice}</Notice>}

      {/* ---------------------------------------------------------- users */}
      <section aria-label="Users">
        {users === null ? (
          <Spinner label="Loading users…" />
        ) : (
          <div className="overflow-hidden rounded-sm border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-card text-left">
                  <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">User</th>
                  <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Status</th>
                  <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Last login</th>
                  <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Admin role</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isSelf = me?.id === user.id;
                  const hasAdminRole = user.roles.some((r) => ADMIN_ROLES.has(r));
                  return (
                    <tr key={user.id} className="border-t border-border bg-background">
                      <td className="px-4 py-3">
                        <span className="font-medium">{user.displayName}</span>
                        {isSelf && <span className="text-muted-foreground"> (you)</span>}
                        <span className="block text-xs text-muted-foreground">{user.email}</span>
                        <span className="mt-1 flex gap-1">
                          {user.roles.map((role) => (
                            <Badge key={role}>{role.replace(/_/g, " ")}</Badge>
                          ))}
                        </span>
                      </td>
                      <td className="px-4 py-3">{user.status}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDateTime(user.lastLoginAt)}</td>
                      <td className="px-4 py-3">
                        {hasPermission("roles.manage") ? (
                          <select
                            className={inputCls}
                            style={{ maxWidth: 190 }}
                            value={primaryRole(user)}
                            aria-label={`Administrative role for ${user.email}`}
                            onChange={(e) => {
                              const role = e.target.value;
                              if (role !== primaryRole(user)) setRoleTarget({ user, role });
                            }}
                          >
                            {ASSIGNABLE_ROLES.map((role) => (
                              <option key={role} value={role}>
                                {role.replace(/_/g, " ")}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-muted-foreground">{primaryRole(user).replace(/_/g, " ")}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {hasAdminRole && hasPermission("users.manage") && (
                          <Btn size="sm" variant="ghost" onClick={() => setResetTarget(user)}>
                            <KeyRound size={14} /> Reset MFA
                          </Btn>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------- invitations */}
      <section aria-label="Invitations" className="space-y-3">
        <h2 className="font-display text-xl tracking-wide">Invitations</h2>
        {hasPermission("invitations.create") && (
          <InviteForm
            onCreated={async (message) => {
              setNotice(message);
              await load();
            }}
            onError={setError}
            onStepUpRequired={(retry) => setStepUpRetry({ run: retry })}
          />
        )}
        {invitations === null ? (
          <Spinner label="Loading invitations…" />
        ) : invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invitations yet.</p>
        ) : (
          <div className="overflow-hidden rounded-sm border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-card text-left">
                  <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Email</th>
                  <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Role</th>
                  <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Status</th>
                  <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Expires</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => (
                  <tr key={invitation.id} className="border-t border-border bg-background">
                    <td className="px-4 py-3">{invitation.email}</td>
                    <td className="px-4 py-3">{invitation.role.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3">
                      <Badge tone={invitation.status === "PENDING" ? "accent" : "muted"}>{invitation.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDateTime(invitation.expiresAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {invitation.status === "PENDING" && hasPermission("invitations.revoke") && (
                        <Btn
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            setError(null);
                            try {
                              await usersApi.revokeInvitation(invitation.id);
                              setNotice(`Invitation for ${invitation.email} revoked.`);
                              await load();
                            } catch (err) {
                              setError(err);
                            }
                          }}
                        >
                          Revoke
                        </Btn>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------- roles */}
      {roles.length > 0 && (
        <section aria-label="Roles" className="space-y-2">
          <h2 className="font-display text-xl tracking-wide">Roles</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {roles.map((role) => (
              <div key={role.code} className="rounded-sm border border-border bg-card px-4 py-3">
                <p className="font-medium">{role.name}</p>
                {role.description && <p className="text-sm text-muted-foreground">{role.description}</p>}
                <p className="mt-1 font-mono text-xs text-muted-foreground">{role.permissions.length} permissions</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <ConfirmDialog
        open={roleTarget !== null}
        title="Change administrative role"
        confirmLabel="Change role"
        busy={busy}
        body={
          <p>
            Set <strong>{roleTarget?.user.email}</strong> to{" "}
            <strong>{roleTarget?.role.replace(/_/g, " ")}</strong>? Their existing sessions will be revoked.
          </p>
        }
        onConfirm={() => void confirmRole()}
        onCancel={() => setRoleTarget(null)}
      />
      <ConfirmDialog
        open={resetTarget !== null}
        title="Reset two-factor authentication"
        confirmLabel="Reset MFA"
        danger
        busy={busy}
        body={
          <p>
            Reset MFA for <strong>{resetTarget?.email}</strong>? All their sessions are revoked and they must enrol a
            new authenticator at their next login.
          </p>
        }
        onConfirm={() => void confirmReset()}
        onCancel={() => setResetTarget(null)}
      />
      <StepUpModal
        open={stepUpRetry !== null}
        onCancel={() => setStepUpRetry(null)}
        onVerified={async () => {
          const retry = stepUpRetry;
          setStepUpRetry(null);
          if (retry) {
            try {
              await retry.run();
            } catch (err) {
              setError(err);
            }
          }
        }}
      />
    </div>
  );
}

function InviteForm({
  onCreated,
  onError,
  onStepUpRequired,
}: {
  onCreated: (message: string) => void;
  onError: (error: unknown) => void;
  /** Park a retry of this submission while the step-up modal verifies. */
  onStepUpRequired: (retry: () => Promise<void>) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("ADMIN");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const invitation = await usersApi.createInvitation(email.trim(), role);
    setEmail("");
    onCreated(`Invitation sent to ${invitation.email} (${invitation.role.replace(/_/g, " ")}), expires ${formatDateTime(invitation.expiresAt)}.`);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      await create();
    } catch (err) {
      if (isStepUpError(err)) {
        // Retry closes over the current email/role, still in the form.
        onStepUpRequired(create);
      } else {
        onError(err instanceof ApiError ? err : new Error("Could not create the invitation."));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-sm border border-border bg-card px-4 py-3">
      <div style={{ minWidth: 260 }}>
        <Field label="Invite by email">
          <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="name@example.org" />
        </Field>
      </div>
      <div style={{ minWidth: 180 }}>
        <Field label="Role">
          <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Invitation role">
            {INVITABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Btn type="submit" variant="accent" disabled={busy}>
        <MailPlus size={15} /> {busy ? "Sending…" : "Send invitation"}
      </Btn>
    </form>
  );
}
