import { ROLE_DESCRIPTIONS, ROLE_LABELS, TENANT_ROLES, isTenantRole, roleLabel, type InvitableRole } from "@3dprintmty/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "./api";
import { useAuth, type SessionUser } from "./auth";
import { CopyIcon, FormActions, IconAction, QuoteButton, SendIcon, TrashIcon, useError } from "./operations";
import { forgetInvite, rememberInvite } from "./roles";
import { FormSkeleton, TableSkeleton } from "./skeleton";
import { authErrorMessage, registerWithPassword, signInWithGoogle, signInWithPassword, supabase } from "./supabase";

interface TeamResponse {
  assignableRoles: InvitableRole[];
  members: Array<{ userId: string; email: string; role: string; since: string; self: boolean; manageable: boolean }>;
  invitations: Array<{ id: string; email: string; role: string; expiresAt: string; expired: boolean; manageable: boolean }>;
}

interface InviteLink {
  email: string;
  role: string;
  url: string;
}

function day(value: string) {
  return new Date(value).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

export function RoleBadge({ role }: { role: string }) {
  return <span className={`res res-badge role-${role}`}>{roleLabel(role)}</span>;
}

export function TeamPage() {
  const client = useQueryClient();
  const { error, pendingKey, run } = useError();
  const [link, setLink] = useState<InviteLink | null>(null);
  const [copied, setCopied] = useState(false);
  const team = useQuery({ queryKey: ["team"], queryFn: () => api<TeamResponse>("/team") });
  const assignable = team.data?.assignableRoles ?? [];
  const [inviteRole, setInviteRole] = useState<InvitableRole | "">("");
  const role = inviteRole || assignable[0] || "";
  const refresh = () => client.invalidateQueries({ queryKey: ["team"] });

  function share(result: { email: string; role: string; acceptPath: string }) {
    setCopied(false);
    setLink({ email: result.email, role: result.role, url: `${window.location.origin}${result.acceptPath}` });
  }

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1 style={{ margin: 0 }}>Equipo</h1>
      <p style={{ margin: 0 }}>Invita a las personas de tu taller y elige qué puede hacer cada una. El rol se aplica en cuanto lo cambias.</p>
      {assignable.length ? (
        <form
          className="card form-vertical"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            void run(async () => {
              const result = await api<{ email: string; role: string; acceptPath: string }>("/invitations", {
                method: "POST",
                body: JSON.stringify({ email: data.get("email"), role }),
              });
              share(result);
              form.reset();
              await refresh();
            }, "invite");
          }}
        >
          <h2 style={{ margin: 0 }}>Invitar a alguien</h2>
          <label>Correo<input name="email" type="email" required placeholder="persona@correo.com" autoComplete="off" /></label>
          <label>
            Rol
            <select value={role} onChange={(event) => setInviteRole(event.target.value as InvitableRole)}>
              {assignable.map((item) => <option key={item} value={item}>{ROLE_LABELS[item]}</option>)}
            </select>
          </label>
          {role ? <p className="costing-hint" style={{ margin: 0 }}>{ROLE_DESCRIPTIONS[role]}</p> : null}
          <FormActions>
            <button className="primary" type="submit" disabled={pendingKey !== null} aria-busy={pendingKey === "invite"}>
              <SendIcon />
              Crear invitación
            </button>
          </FormActions>
        </form>
      ) : null}
      {link ? (
        <div className="card banner" style={{ display: "grid", gap: 10 }}>
          <strong>Invitación lista para {link.email} como {roleLabel(link.role)}</strong>
          <p style={{ margin: 0 }}>Mándale este enlace por WhatsApp o correo. Vence en 7 días y solo funciona con ese correo; todavía no enviamos el correo automático.</p>
          <input readOnly value={link.url} onFocus={(event) => event.currentTarget.select()} aria-label="Enlace de invitación" />
          <div className="quote-actions-row">
            <QuoteButton
              label={copied ? "Enlace copiado" : "Copiar enlace"}
              tone="doc"
              icon={<CopyIcon />}
              onClick={() => {
                void navigator.clipboard.writeText(link.url).then(() => setCopied(true));
              }}
            />
          </div>
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}

      <h2 style={{ margin: 0 }}>Integrantes</h2>
      {team.isPending ? <TableSkeleton columns={4} rows={3} /> : team.data ? (
        <table>
          <thead><tr><th>Correo</th><th>Rol</th><th>Desde</th><th aria-label="Acciones" /></tr></thead>
          <tbody>
            {team.data.members.map((member) => (
              <tr key={member.userId}>
                <td>{member.email}{member.self ? <span style={{ color: "var(--color-muted)" }}> (tú)</span> : null}</td>
                <td>
                  {member.manageable && assignable.length ? (
                    <select
                      aria-label={`Rol de ${member.email}`}
                      value={member.role}
                      disabled={pendingKey !== null}
                      style={{ maxWidth: 200 }}
                      onChange={(event) => {
                        const next = event.target.value;
                        void run(async () => {
                          await api(`/team/members/${member.userId}`, { method: "PATCH", body: JSON.stringify({ role: next }) });
                          await refresh();
                        }, `role-${member.userId}`);
                      }}
                    >
                      {assignable.includes(member.role as InvitableRole) ? null : <option value={member.role}>{roleLabel(member.role)}</option>}
                      {assignable.map((item) => <option key={item} value={item}>{ROLE_LABELS[item]}</option>)}
                    </select>
                  ) : (
                    <RoleBadge role={member.role} />
                  )}
                </td>
                <td>{day(member.since)}</td>
                <td>
                  {member.manageable ? (
                    <IconAction
                      label={`Dar de baja a ${member.email}`}
                      tone="delete"
                      pending={pendingKey === `remove-${member.userId}`}
                      disabled={pendingKey !== null}
                      onClick={() => {
                        if (!window.confirm(`¿Dar de baja a ${member.email}? Pierde el acceso al taller en ese momento.`)) return;
                        void run(async () => {
                          await api(`/team/members/${member.userId}`, { method: "DELETE" });
                          await refresh();
                        }, `remove-${member.userId}`);
                      }}
                    >
                      <TrashIcon />
                    </IconAction>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="error">No se pudo cargar el equipo.</p>}

      {team.data?.invitations.length ? (
        <>
          <h2 style={{ margin: 0 }}>Invitaciones pendientes</h2>
          <table>
            <thead><tr><th>Correo</th><th>Rol</th><th>Vence</th><th aria-label="Acciones" /></tr></thead>
            <tbody>
              {team.data.invitations.map((invite) => (
                <tr key={invite.id}>
                  <td>{invite.email}</td>
                  <td><RoleBadge role={invite.role} /></td>
                  <td>{invite.expired ? <span className="error">Venció el {day(invite.expiresAt)}</span> : day(invite.expiresAt)}</td>
                  <td>
                    {invite.manageable ? (
                      <div className="record-actions">
                        <IconAction
                          label="Generar enlace nuevo"
                          tone="send"
                          pending={pendingKey === `renew-${invite.id}`}
                          disabled={pendingKey !== null}
                          onClick={() => {
                            void run(async () => {
                              const result = await api<{ email: string; role: string; acceptPath: string }>(`/invitations/${invite.id}/renew`, { method: "POST" });
                              share(result);
                              await refresh();
                            }, `renew-${invite.id}`);
                          }}
                        >
                          <SendIcon />
                        </IconAction>
                        <IconAction
                          label={`Cancelar invitación de ${invite.email}`}
                          tone="delete"
                          pending={pendingKey === `revoke-${invite.id}`}
                          disabled={pendingKey !== null}
                          onClick={() => {
                            if (!window.confirm(`¿Cancelar la invitación de ${invite.email}? El enlace deja de funcionar.`)) return;
                            void run(async () => {
                              await api(`/invitations/${invite.id}`, { method: "DELETE" });
                              if (link?.email === invite.email) setLink(null);
                              await refresh();
                            }, `revoke-${invite.id}`);
                          }}
                        >
                          <TrashIcon />
                        </IconAction>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <h2 style={{ margin: 0 }}>Qué puede hacer cada rol</h2>
      <div className="card role-guide">
        {TENANT_ROLES.map((item) => (
          <div key={item}>
            <RoleBadge role={item} />
            <p style={{ margin: 0 }}>{ROLE_DESCRIPTIONS[item]}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

interface InvitePreview {
  email: string;
  role: string;
  roleLabel: string;
  workshop: string;
  expiresAt: string;
}

export function InvitePage() {
  const { token = "" } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<"register" | "login">("register");
  const preview = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => api<InvitePreview>(`/invitations/preview/${token}`),
    retry: false,
  });

  useEffect(() => {
    if (preview.data) rememberInvite(token);
    if (preview.error) forgetInvite();
  }, [preview.data, preview.error, token]);

  async function join(sessionToken: string | null, password?: string) {
    const result = await api<{ token: string | null }>("/invitations/accept", {
      method: "POST",
      headers: sessionToken ? { authorization: `Bearer ${sessionToken}` } : {},
      body: JSON.stringify(password ? { token, password } : { token }),
    });
    const nextToken = result.token ?? sessionToken;
    if (!nextToken) throw new Error("No hay sesión.");
    const me = await api<{ user: SessionUser }>("/auth/me", { headers: { authorization: `Bearer ${nextToken}` } });
    forgetInvite();
    auth.setSession(nextToken, me.user);
    navigate("/app");
  }

  async function attempt(key: string, action: () => Promise<void>) {
    setError(null);
    setBusy(key);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof ApiError || caught instanceof Error ? caught.message : "No se pudo aceptar la invitación.");
    } finally {
      setBusy(null);
    }
  }

  const shell = (body: ReactNode) => (
    <main className="main" style={{ maxWidth: 480 }}>
      <h1>Invitación al taller</h1>
      {body}
    </main>
  );

  if (preview.isPending) return shell(<FormSkeleton fields={2} />);
  if (!preview.data) {
    return shell(
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <p className="error">{preview.error instanceof ApiError ? preview.error.message : "No se pudo abrir la invitación."}</p>
        <Link to="/entrar">Ir a entrar</Link>
      </div>,
    );
  }
  const invite = preview.data;
  const summary = (
    <div style={{ display: "grid", gap: 6 }}>
      <p style={{ margin: 0 }}>Te invitaron a <strong>{invite.workshop}</strong> como <RoleBadge role={invite.role} /></p>
      {isTenantRole(invite.role) ? <p className="costing-hint" style={{ margin: 0 }}>{ROLE_DESCRIPTIONS[invite.role]}</p> : null}
      <p style={{ margin: 0 }}>Correo de la invitación: <strong>{invite.email}</strong></p>
    </div>
  );

  const signedInAs = auth.token && auth.user ? auth.user.email.toLowerCase() : null;

  if (supabase && signedInAs && signedInAs !== invite.email) {
    return shell(
      <div className="card form-vertical" style={{ display: "grid", gap: 12 }}>
        {summary}
        <p className="error">Entraste como {signedInAs}. La invitación es para {invite.email}.</p>
        <FormActions>
          <button className="primary" type="button" onClick={() => auth.logout()}>Salir y entrar con {invite.email}</button>
        </FormActions>
      </div>,
    );
  }

  if (supabase && signedInAs) {
    return shell(
      <div className="card form-vertical" style={{ display: "grid", gap: 12 }}>
        {summary}
        {auth.user?.tenantId ? <p style={{ margin: 0 }}>Tu cuenta ya pertenece a un taller. <Link to="/app">Ir a mi taller</Link></p> : null}
        {error ? <p className="error">{error}</p> : null}
        <FormActions>
          <button className="primary" type="button" disabled={busy !== null} aria-busy={busy === "join"} onClick={() => void attempt("join", () => join(auth.token))}>
            Unirme a {invite.workshop}
          </button>
        </FormActions>
      </div>,
    );
  }

  return shell(
    <form
      className="card form-vertical"
      onSubmit={(event) => {
        event.preventDefault();
        const password = String(new FormData(event.currentTarget).get("password") ?? "");
        void attempt("password", async () => {
          if (!supabase) {
            await join(null, password);
            return;
          }
          if (mode === "register") {
            try {
              const created = await registerWithPassword(invite.email, password);
              if (created.error) throw new Error(authErrorMessage(created.error));
            } catch (caught) {
              if (caught instanceof ApiError && caught.code === "email_taken") {
                setMode("login");
                throw new Error("Ya tienes cuenta con ese correo. Escribe tu contraseña para entrar.");
              }
              throw caught;
            }
          } else {
            const signed = await signInWithPassword(invite.email, password);
            if (signed.error) throw new Error(authErrorMessage(signed.error));
          }
          const user = await auth.adoptSupabaseSession();
          if (!user) throw new Error("No se pudo abrir la sesión.");
          await join(localStorage.getItem("printmty.token"));
        });
      }}
    >
      {summary}
      <label>
        {mode === "register" ? "Crea una contraseña" : "Tu contraseña"}
        <input name="password" type="password" minLength={8} required autoComplete={mode === "register" ? "new-password" : "current-password"} />
      </label>
      {supabase ? null : <p className="costing-hint" style={{ margin: 0 }}>Si ya tienes cuenta con ese correo, usa tu contraseña de siempre.</p>}
      {error ? <p className="error">{error}</p> : null}
      <FormActions>
        <button className="primary" type="submit" disabled={busy !== null} aria-busy={busy === "password"}>
          {mode === "register" && supabase ? "Crear cuenta y unirme" : "Entrar y unirme"}
        </button>
      </FormActions>
      {supabase ? (
        <div style={{ display: "grid", gap: 8 }}>
          <button className="link-button" type="button" style={{ justifySelf: "start" }} onClick={() => { setError(null); setMode(mode === "register" ? "login" : "register"); }}>
            {mode === "register" ? "Ya tengo cuenta con ese correo" : "Todavía no tengo cuenta"}
          </button>
          <button
            className="ghost"
            type="button"
            disabled={busy !== null}
            aria-busy={busy === "google"}
            onClick={() => void attempt("google", () => signInWithGoogle())}
          >
            Entrar con Google ({invite.email})
          </button>
        </div>
      ) : null}
    </form>,
  );
}
