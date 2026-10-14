import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api, ApiError } from "./api";
import { useAuth, type SessionUser } from "./auth";
import { homeFor } from "./roles";
import { authErrorMessage, registerWithPassword, signInWithGoogle, signInWithPassword, supabase } from "./supabase";
import { Notice } from "./notice";
import { WorkshopSteps } from "./workshop-steps";
import { AUTH_FEATURES } from "./auth-features";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const passwordId = useId();
  const hintId = useId();
  const registering = mode === "register";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    setError(null);
    setBusy("login");
    try {
      if (supabase) {
        const result =
          mode === "login"
            ? await signInWithPassword(email, password)
            : await registerWithPassword(email, password);
        if (result.error) {
          setError(authErrorMessage(result.error));
          return;
        }
        if (!result.data.session) {
          setError(t("auth.confirmEmail"));
          return;
        }
        const user = await auth.adoptSupabaseSession();
        if (!user) return;
        navigate(homeFor(user));
        return;
      }
      const session = await api<{ token: string; user: SessionUser }>(
        mode === "login" ? "/auth/login" : "/auth/register",
        { method: "POST", body: JSON.stringify({ email, password }) },
      );
      auth.setSession(session.token, session.user);
      navigate(homeFor(session.user));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("auth.requestError"));
    } finally {
      setBusy(null);
    }
  }

  async function onGoogle() {
    setError(null);
    setBusy("google");
    try {
      await signInWithGoogle();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("auth.requestError"));
    } finally {
      setBusy(null);
    }
  }

  if (auth.token && auth.user) return <Navigate to={homeFor(auth.user)} replace />;

  return (
    <main className={`onboarding-page auth-page${registering ? " auth-register" : ""}`}>
      <header className="onboarding-header">
        <p className="brand">{t("app.name")}</p>
        <h1>{t(registering ? "auth.registerTitle" : "auth.loginTitle")}</h1>
        <p>{t(registering ? "auth.registerIntro" : "auth.loginIntro")}</p>
      </header>
      {registering ? <WorkshopSteps step={0} /> : null}
      <form className="card auth-panel" onSubmit={onSubmit}>
        {registering ? <p className="onboarding-counter">{t("onboarding.stepCount", { current: 1, total: 6 })} · {t("onboarding.account")}</p> : null}
        {supabase && AUTH_FEATURES.googleLogin ? <>
          <button className="ghost auth-google" type="button" disabled={busy !== null} aria-busy={busy === "google"} onClick={() => void onGoogle()}>
            {t("auth.google")}
          </button>
          <div className="auth-divider"><span>{t("auth.emailAlternative")}</span></div>
        </> : null}
        <fieldset className="auth-fields" disabled={busy !== null}>
        <label>
          {t("auth.email")}
          <input name="email" type="email" required autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder={t("auth.emailPlaceholder")} />
        </label>
        <div className="auth-password-field">
          <label htmlFor={passwordId}>{t("auth.password")}</label>
          <div className="auth-password-input">
            <input id={passwordId} name="password" type={showPassword ? "text" : "password"} required minLength={8} autoComplete={registering ? "new-password" : "current-password"} aria-describedby={registering ? hintId : undefined} />
            <button type="button" className="auth-password-toggle" aria-pressed={showPassword} aria-controls={passwordId} aria-label={t(showPassword ? "auth.hidePassword" : "auth.showPassword")} onClick={() => setShowPassword((current) => !current)}>{t(showPassword ? "auth.hide" : "auth.show")}</button>
          </div>
          {registering ? <p id={hintId} className="auth-hint">{t("auth.passwordHint")}</p> : null}
        </div>
        </fieldset>
        {error ? <Notice tone="error" title={t(registering ? "auth.registerError" : "auth.loginError")}>{error}</Notice> : null}
        <button className="primary" type="submit" disabled={busy !== null} aria-busy={busy === "login"}>
          {busy === "login" ? t(registering ? "auth.registering" : "auth.loggingIn") : t(registering ? "auth.registerContinue" : "auth.login")}
        </button>
      </form>
      <p className="auth-switch">{t(registering ? "auth.hasAccount" : "auth.noAccount")} <Link to={registering ? "/entrar" : "/registro"}>{t(registering ? "auth.login" : "auth.register")}</Link></p>
    </main>
  );
}
