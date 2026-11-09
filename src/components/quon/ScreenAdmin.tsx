/**
 * Operator admin screen (/admin) - account + invite management for this
 * instance. Metadata only: the server (and therefore this screen) never sees
 * user content, which stays end-to-end encrypted for admins too.
 *
 * Visibility is gated on me.role === 'admin' (AppSidebar + the route), but the
 * SERVER is the enforcement point: every adminApi call re-checks the role and
 * answers 403 for non-admins.
 */
import { useCallback, useEffect, useState } from "react";
import { Copy, Loader2, MailPlus, ShieldCheck, Ticket, Trash2, UserX } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  adminApi,
  type AdminAuditEntry,
  type AdminInvite,
  type AdminStats,
  type AdminUser,
} from "@/lib/api/adminApi";
import { useAuth } from "@/lib/authStore";
import { useT } from "@/lib/i18n/i18n";

const CARD = "rounded-xl border border-quon-border bg-quon-surface p-4";

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function fmtDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString();
}

export function ScreenAdmin() {
  const { t } = useT();
  const auth = useAuth();
  const me = auth.user;

  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [audit, setAudit] = useState<AdminAuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [suspendTarget, setSuspendTarget] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [limitsTarget, setLimitsTarget] = useState<AdminUser | null>(null);
  const [budgetInput, setBudgetInput] = useState("");
  const [storageInput, setStorageInput] = useState("");
  const [inviteNote, setInviteNote] = useState("");
  const [freshInviteCode, setFreshInviteCode] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [u, s, inv, a] = await Promise.all([
        adminApi.listUsers(),
        adminApi.stats(),
        adminApi.listInvites(),
        adminApi.audit(),
      ]);
      setUsers(u);
      setStats(s);
      setInvites(inv);
      setAudit(a);
      setError(null);
    } catch {
      setError(t("admin.loadError"));
    }
  }, [t]);

  useEffect(() => {
    if (me?.role === "admin") void reload();
  }, [me?.role, reload]);

  if (me?.role !== "admin") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-5 py-10">
        <p className="text-sm text-quon-muted">{t("admin.denied")}</p>
      </div>
    );
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await reload();
    } catch {
      setError(t("admin.loadError"));
    } finally {
      setBusy(false);
    }
  }

  function openLimits(u: AdminUser) {
    setBudgetInput(u.budget_override_usd != null ? String(u.budget_override_usd) : "");
    setStorageInput(
      u.storage_override_bytes != null
        ? String(Math.round(u.storage_override_bytes / (1024 * 1024)))
        : "",
    );
    setLimitsTarget(u);
  }

  async function saveLimits() {
    if (!limitsTarget) return;
    const budget = budgetInput.trim() === "" ? null : Number(budgetInput);
    const storageMb = storageInput.trim() === "" ? null : Number(storageInput);
    if (
      (budget != null && !Number.isFinite(budget)) ||
      (storageMb != null && !Number.isFinite(storageMb))
    )
      return;
    const target = limitsTarget;
    setLimitsTarget(null);
    await run(() =>
      adminApi.setEntitlements(
        target.id,
        budget,
        storageMb == null ? null : Math.round(storageMb * 1024 * 1024),
      ),
    );
  }

  async function createInvite() {
    setBusy(true);
    try {
      const inv = await adminApi.createInvite(inviteNote.trim());
      setFreshInviteCode(inv.code ?? null);
      setInviteNote("");
      await reload();
    } catch {
      setError(t("admin.loadError"));
    } finally {
      setBusy(false);
    }
  }

  const now = Date.now();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
      <div>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-quon-indigo" />
          <h1 className="text-lg font-semibold text-quon-text">{t("admin.title")}</h1>
        </div>
        <p className="mt-1 max-w-2xl text-xs text-quon-muted">{t("admin.subtitle")}</p>
      </div>

      {error && (
        <div className="rounded-lg border border-quon-rose/40 bg-quon-rose/10 px-3 py-2 text-xs text-quon-rose">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-quon-green/40 bg-quon-green/10 px-3 py-2 text-xs text-quon-green">
          {notice}
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-lg border border-quon-border bg-quon-surface px-3 py-1.5 text-quon-text">
            {t("admin.statsUsers")}: <b>{stats.users_total}</b>{" "}
            <span className="text-quon-muted">
              ({stats.users_active} {t("admin.statsActive")}, {stats.users_pending}{" "}
              {t("admin.statsPending")}, {stats.users_suspended} {t("admin.statsSuspended")})
            </span>
          </span>
          <span className="rounded-lg border border-quon-border bg-quon-surface px-3 py-1.5 text-quon-text">
            {t("admin.statsStorage")}: <b>{fmtBytes(stats.storage_bytes_total)}</b>
          </span>
          <span className="rounded-lg border border-quon-border bg-quon-surface px-3 py-1.5 text-quon-text">
            {t("admin.statsInvites")}: <b>{stats.invites_open}</b>
          </span>
        </div>
      )}

      {/* Users */}
      <section className={CARD}>
        <div className="text-sm font-semibold text-quon-text">{t("admin.usersTitle")}</div>
        {users === null ? (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-quon-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </div>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead>
                <tr className="border-b border-quon-border text-[10px] uppercase tracking-wide text-quon-muted">
                  <th className="py-1.5 pr-3">{t("admin.colEmail")}</th>
                  <th className="py-1.5 pr-3">{t("admin.colStatus")}</th>
                  <th className="py-1.5 pr-3">{t("admin.colLastSeen")}</th>
                  <th className="py-1.5 pr-3">{t("admin.colStorage")}</th>
                  <th className="py-1.5 pr-3">{t("admin.colBudget")}</th>
                  <th className="py-1.5" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-quon-border/50">
                    <td className="py-2 pr-3 text-quon-text">
                      {u.email}
                      {u.role === "admin" && (
                        <span className="ml-1.5 rounded bg-quon-indigo/20 px-1.5 py-0.5 text-[10px] text-quon-indigo">
                          {t("admin.roleAdmin")}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={
                          u.status === "active"
                            ? "text-quon-green"
                            : u.status === "suspended"
                              ? "text-quon-rose"
                              : "text-quon-yellow"
                        }
                      >
                        {u.status === "active"
                          ? t("admin.statusActive")
                          : u.status === "suspended"
                            ? t("admin.statusSuspended")
                            : t("admin.statusPending")}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-quon-muted">{fmtDate(u.last_seen)}</td>
                    <td className="py-2 pr-3 text-quon-muted">
                      {fmtBytes(u.storage_bytes)}
                      {u.storage_override_bytes != null && (
                        <span className="ml-1 rounded bg-quon-yellow/20 px-1 text-[10px] text-quon-yellow">
                          {t("admin.overrideBadge")}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-quon-muted">
                      {u.provisioned
                        ? t("admin.budgetUsedOf", {
                            used: (u.usage_usd ?? 0).toFixed(2),
                            limit: (u.limit_usd ?? 0).toFixed(0),
                          })
                        : "—"}
                      {u.budget_override_usd != null && (
                        <span className="ml-1 rounded bg-quon-yellow/20 px-1 text-[10px] text-quon-yellow">
                          {t("admin.overrideBadge")}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          disabled={busy}
                          className="rounded-lg border border-quon-border px-2 py-1 text-[11px] text-quon-text hover:border-quon-indigo/50"
                        >
                          …
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {u.id !== me.id && u.status !== "pending" && (
                            <DropdownMenuItem
                              onClick={() =>
                                u.status === "suspended"
                                  ? void run(() => adminApi.setStatus(u.id, "active"))
                                  : setSuspendTarget(u)
                              }
                            >
                              <UserX className="mr-1.5 h-3.5 w-3.5" />
                              {u.status === "suspended"
                                ? t("admin.actionReactivate")
                                : t("admin.actionSuspend")}
                            </DropdownMenuItem>
                          )}
                          {u.status === "pending" && (
                            <DropdownMenuItem
                              onClick={() =>
                                void run(async () => {
                                  await adminApi.resendVerification(u.id);
                                  setNotice(t("admin.resendDone"));
                                })
                              }
                            >
                              <MailPlus className="mr-1.5 h-3.5 w-3.5" />
                              {t("admin.actionResend")}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => openLimits(u)}>
                            {t("admin.actionLimits")}
                          </DropdownMenuItem>
                          {u.id !== me.id && (
                            <DropdownMenuItem
                              onClick={() =>
                                void run(() =>
                                  adminApi.setRole(u.id, u.role === "admin" ? "user" : "admin"),
                                )
                              }
                            >
                              {u.role === "admin"
                                ? t("admin.actionRemoveAdmin")
                                : t("admin.actionMakeAdmin")}
                            </DropdownMenuItem>
                          )}
                          {u.id !== me.id && (
                            <DropdownMenuItem
                              className="text-quon-rose focus:text-quon-rose"
                              onClick={() => setDeleteTarget(u)}
                            >
                              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                              {t("admin.actionDelete")}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Invites */}
      <section className={CARD}>
        <div className="flex items-center gap-2">
          <Ticket className="h-4 w-4 text-quon-indigo" />
          <div className="text-sm font-semibold text-quon-text">{t("admin.invitesTitle")}</div>
        </div>
        <p className="mt-1 text-[11px] text-quon-muted">{t("admin.invitesIntro")}</p>
        <div className="mt-2 flex items-center gap-2">
          <input
            value={inviteNote}
            onChange={(e) => setInviteNote(e.target.value)}
            placeholder={t("admin.inviteNotePlaceholder")}
            className="w-full max-w-sm rounded-lg border border-quon-border bg-quon-surface-2 px-3 py-1.5 text-xs text-quon-text outline-none placeholder:text-quon-muted"
          />
          <button
            onClick={() => void createInvite()}
            disabled={busy}
            className="shrink-0 rounded-lg bg-quon-indigo px-3 py-1.5 text-xs font-semibold text-white hover:bg-quon-indigo-hover disabled:opacity-50"
          >
            {t("admin.inviteCreate")}
          </button>
        </div>
        {freshInviteCode && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-quon-indigo/40 bg-quon-indigo/10 px-3 py-2 text-xs text-quon-text">
            <span>{t("admin.inviteCodeIs")}</span>
            <code className="rounded bg-quon-surface-2 px-1.5 py-0.5 font-mono">
              {freshInviteCode}
            </code>
            <button
              onClick={() => void navigator.clipboard?.writeText(freshInviteCode)}
              className="text-quon-indigo hover:opacity-80"
              aria-label="copy"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <ul className="mt-2 space-y-1">
          {invites.length === 0 && (
            <li className="text-[11px] text-quon-muted">{t("admin.invitesEmpty")}</li>
          )}
          {invites.map((inv) => {
            const state = inv.used_at
              ? t("admin.inviteUsed")
              : inv.expires_at < now
                ? t("admin.inviteExpired")
                : t("admin.inviteOpen");
            return (
              <li
                key={inv.id}
                className="flex items-center justify-between rounded-lg border border-quon-border bg-quon-surface-2 px-3 py-1.5 text-xs"
              >
                <span className="truncate text-quon-text">
                  {inv.note || "—"}{" "}
                  <span
                    className={
                      inv.used_at
                        ? "text-quon-muted"
                        : inv.expires_at < now
                          ? "text-quon-rose"
                          : "text-quon-green"
                    }
                  >
                    · {state}
                  </span>
                </span>
                {!inv.used_at && inv.expires_at >= now && (
                  <button
                    onClick={() => void run(() => adminApi.revokeInvite(inv.id))}
                    disabled={busy}
                    className="shrink-0 text-[11px] text-quon-muted hover:text-quon-rose"
                  >
                    {t("admin.inviteRevoke")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Audit */}
      <section className={CARD}>
        <div className="text-sm font-semibold text-quon-text">{t("admin.auditTitle")}</div>
        <ul className="mt-2 space-y-1 text-[11px] text-quon-muted">
          {audit.length === 0 && <li>{t("admin.auditEmpty")}</li>}
          {audit.map((a, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 tabular-nums">
                {new Date(a.created_at).toLocaleString()}
              </span>
              <span className="text-quon-text">{a.action}</span>
              <span className="truncate">{a.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Suspend confirm */}
      <AlertDialog open={suspendTarget !== null} onOpenChange={(o) => !o && setSuspendTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.actionSuspend")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.suspendConfirm", { email: suspendTarget?.email ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("admin.limitsCancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = suspendTarget;
                setSuspendTarget(null);
                if (target) void run(() => adminApi.setStatus(target.id, "suspended"));
              }}
            >
              {t("admin.actionSuspend")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm - destructive and irrecoverable (ZK: no export, no undo) */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.actionDelete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.deleteConfirm", { email: deleteTarget?.email ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("admin.limitsCancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-quon-rose text-white hover:bg-quon-rose/90"
              onClick={() => {
                const target = deleteTarget;
                setDeleteTarget(null);
                if (target) void run(() => adminApi.deleteUser(target.id));
              }}
            >
              {t("admin.deleteButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Limits dialog */}
      <Dialog open={limitsTarget !== null} onOpenChange={(o) => !o && setLimitsTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {t("admin.limitsTitle", { email: limitsTarget?.email ?? "" })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <label className="block">
              <span className="text-quon-muted">{t("admin.limitsBudget")}</span>
              <input
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                inputMode="decimal"
                className="mt-1 w-full rounded-lg border border-quon-border bg-quon-surface-2 px-3 py-1.5 text-quon-text outline-none"
              />
            </label>
            <label className="block">
              <span className="text-quon-muted">{t("admin.limitsStorage")}</span>
              <input
                value={storageInput}
                onChange={(e) => setStorageInput(e.target.value)}
                inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-quon-border bg-quon-surface-2 px-3 py-1.5 text-quon-text outline-none"
              />
            </label>
            <p className="text-[10px] text-quon-muted">{t("admin.limitsHint")}</p>
          </div>
          <DialogFooter>
            <button
              onClick={() => setLimitsTarget(null)}
              className="rounded-lg border border-quon-border px-3 py-1.5 text-xs text-quon-text"
            >
              {t("admin.limitsCancel")}
            </button>
            <button
              onClick={() => void saveLimits()}
              className="rounded-lg bg-quon-indigo px-3 py-1.5 text-xs font-semibold text-white hover:bg-quon-indigo-hover"
            >
              {t("admin.limitsSave")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
