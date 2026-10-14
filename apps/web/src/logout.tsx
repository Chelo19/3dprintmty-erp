import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./auth";

export function LogoutButton({ children, className = "session-logout", redirect = true, redirectTo = "/entrar", disabled = false }: { children?: ReactNode; className?: string; redirect?: boolean; redirectTo?: string; disabled?: boolean }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function logout() {
    if (busy || disabled) return;
    setBusy(true);
    setFailed(false);
    try {
      await auth.logout();
      if (redirect) navigate(redirectTo, { replace: true });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="session-actions">
      <button className={className} type="button" disabled={busy || disabled} aria-busy={busy} onClick={() => void logout()}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M9 4H4v16h5M9 12h11m-4-4 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>{busy ? t("common.loggingOut") : children ?? t("common.logout")}</span>
      </button>
      {failed ? <p className="error" role="alert">{t("common.logoutError")}</p> : null}
    </div>
  );
}
