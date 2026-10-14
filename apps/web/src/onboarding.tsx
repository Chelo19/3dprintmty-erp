import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router-dom";
import { MX_STATES, MX_TAX_REGIMES } from "@3dprintmty/domain";
import { api, ApiError } from "./api";
import { useAuth, type SessionUser } from "./auth";
import { authErrorMessage, registerWithPassword, supabase } from "./supabase";
import { BackButton } from "./back-control";
import { Notice } from "./notice";
import { WorkshopSteps } from "./workshop-steps";
import { LogoutButton } from "./logout";

function readField(data: FormData, key: string, fallback: string) {
  const value = data.get(key);
  return typeof value === "string" ? value : fallback;
}

export function OnboardingPage() {
  const { t } = useTranslation();
  const auth = useAuth();
  const [step, setStep] = useState(auth.token ? 1 : 0);
  const [furthest, setFurthest] = useState(auth.token ? 1 : 0);
  const [created, setCreated] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    legalName: "",
    tradeName: "",
    rfc: "",
    taxRegime: "626",
    fiscalPostalCode: "",
    state: "Jalisco",
    locationName: "Matriz",
    locationPostalCode: "",
    vatRate: "0.16",
    efectivo: true,
    spei: true,
    tarjeta: false,
    mercadopago: false,
    cod: false,
    credito: false,
    seedDemo: true,
    privacyAccepted: false,
  });

  useEffect(() => {
    if (previousStep.current === step && !created) return;
    previousStep.current = step;
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView({ block: "nearest" });
  }, [step, created]);

  if (!auth.token && step > 0) return <Navigate to="/registro" replace />;

  function captureDraft() {
    const data = new FormData(formRef.current!);
    const draft = { ...form };
    const fields = ["legalName", "tradeName", "rfc", "taxRegime", "fiscalPostalCode", "state", "locationName", "locationPostalCode", "vatRate"] as const;
    for (const field of fields) draft[field] = readField(data, field, form[field]);
    if (step === 4) {
      for (const method of ["efectivo", "spei", "tarjeta", "mercadopago", "cod", "credito"] as const) draft[method] = data.has(method);
    }
    if (step === 5) {
      draft.seedDemo = data.has("seedDemo");
      draft.privacyAccepted = data.has("privacyAccepted");
    }
    return draft;
  }

  function back() {
    setForm(captureDraft());
    setError(null);
    setStep(step - 1);
  }

  async function next(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (step === 0) {
      const data = new FormData(event.currentTarget as HTMLFormElement);
      const email = String(data.get("email") ?? "");
      const password = String(data.get("password") ?? "");
      try {
        setSaving(true);
        if (supabase) {
          const created = await registerWithPassword(email, password);
          if (created.error) {
            setError(authErrorMessage(created.error));
            return;
          }
          if (!created.data.session) {
            setError(t("auth.confirmEmail"));
            return;
          }
          const user = await auth.adoptSupabaseSession();
          if (!user) return;
          setStep(1);
          setFurthest(1);
          return;
        }
        const result = await api<{ token: string; user: SessionUser }>("/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        auth.setSession(result.token, result.user);
        setStep(1);
        setFurthest(1);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : "No se pudo crear la cuenta.");
      } finally {
        setSaving(false);
      }
      return;
    }
    const draft = captureDraft();
    setForm(draft);
    if (step < 5) {
      setStep(step + 1);
      setFurthest(Math.max(furthest, step + 1));
      return;
    }
    setSaving(true);
    try {
      const result = await api<{ token: string | null; tenant: { id: string } }>("/onboarding", {
        method: "POST",
        body: JSON.stringify({
          legalName: draft.legalName,
          tradeName: draft.tradeName || draft.legalName,
          rfc: draft.rfc,
          taxRegime: draft.taxRegime,
          fiscalPostalCode: draft.fiscalPostalCode,
          state: draft.state,
          locationName: draft.locationName,
          locationPostalCode: draft.locationPostalCode || draft.fiscalPostalCode,
          vatRate: draft.vatRate,
          paymentMethods: {
            efectivo: draft.efectivo,
            spei: draft.spei,
            tarjeta: draft.tarjeta,
            mercadopago: draft.mercadopago,
            conekta: false,
            stripe: false,
            cod: draft.cod,
            credito: draft.credito,
          },
          seedDemo: draft.seedDemo,
          privacyAccepted: draft.privacyAccepted,
        }),
      });
      const nextToken = result.token ?? auth.token;
      if (!nextToken) throw new Error("No hay sesión.");
      const me = await api<{ user: SessionUser }>("/auth/me", {
        headers: { authorization: `Bearer ${nextToken}` },
      });
      auth.setSession(nextToken, me.user);
      setCreated(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo crear el taller.");
    } finally {
      setSaving(false);
    }
  }

  const steps = [t("onboarding.account"), t("onboarding.company"), t("onboarding.branch"), t("onboarding.tax"), t("onboarding.payments"), t("onboarding.demo")];
  const descriptions = ["accountHelp", "companyHelp", "branchHelp", "taxHelp", "paymentsHelp", "reviewHelp"];
  const paymentLabels: Record<string, string> = { efectivo: "Efectivo", spei: "Transferencia SPEI", tarjeta: "Tarjeta", mercadopago: "Mercado Pago", cod: "Contra entrega", credito: "Crédito" };

  return (
    <main className="onboarding-page">
      <header className="onboarding-header">
        <p className="brand">{t("app.name")}</p>
        <h1>{t("onboarding.title")}</h1>
        <p>{t("onboarding.intro")}</p>
      </header>
      <WorkshopSteps step={step} furthest={furthest} completed={created} />
      {created ? <section className="card onboarding-form onboarding-success">
        <h2 ref={headingRef} tabIndex={-1}>{t("onboarding.createdTitle")}</h2>
        <p>{t("onboarding.createdHelp", { name: form.tradeName || form.legalName })}</p>
        <Link className="primary" to="/app" replace>{t("onboarding.openWorkshop")}</Link>
      </section> : <form ref={formRef} className="card onboarding-form" onSubmit={next}>
        <header className="onboarding-form-header">
          <p className="onboarding-counter" role="status">{t("onboarding.stepCount", { current: step + 1, total: steps.length })}</p>
          <h2 ref={headingRef} tabIndex={-1}>{steps[step]}</h2>
          <p>{t(`onboarding.${descriptions[step]}`)}</p>
        </header>
        <fieldset key={step} className="onboarding-fields" disabled={saving}>
        {step === 0 ? (
          <>
            <label>{t("auth.email")}<input name="email" required type="email" autoComplete="email" /></label>
            <label>{t("auth.password")}<input name="password" required minLength={8} type="password" autoComplete="new-password" /></label>
          </>
        ) : null}
        {step === 1 ? (
          <>
            <label>{t("onboarding.legalName")}<input name="legalName" required defaultValue={form.legalName} /></label>
            <label>{t("onboarding.tradeName")}<input name="tradeName" defaultValue={form.tradeName} /></label>
            <label>{t("onboarding.rfc")}<input name="rfc" required defaultValue={form.rfc} /></label>
            <label>
              {t("onboarding.regime")}
              <select name="taxRegime" defaultValue={form.taxRegime}>
                {MX_TAX_REGIMES.map((regime) => (
                  <option key={regime.code} value={regime.code}>{regime.code} — {regime.label}</option>
                ))}
              </select>
            </label>
            <label>{t("onboarding.postalCode")}<input name="fiscalPostalCode" required pattern="\d{5}" inputMode="numeric" maxLength={5} defaultValue={form.fiscalPostalCode} /></label>
          </>
        ) : null}
        {step === 2 ? (
          <>
            <label>{t("onboarding.locationName")}<input name="locationName" required defaultValue={form.locationName} /></label>
            <label>
              {t("onboarding.state")}
              <select name="state" defaultValue={form.state}>
                {MX_STATES.map((state) => <option key={state}>{state}</option>)}
              </select>
            </label>
            <label>{t("onboarding.branchPostalCode")}<input name="locationPostalCode" required pattern="\d{5}" inputMode="numeric" maxLength={5} defaultValue={form.locationPostalCode || form.fiscalPostalCode} /></label>
          </>
        ) : null}
        {step === 3 ? (
          <label>
            {t("onboarding.vat")}
            <select name="vatRate" defaultValue={form.vatRate}>
              <option value="0.16">IVA 16%</option>
              <option value="0.08">IVA 8% frontera</option>
              <option value="0">Tasa 0</option>
            </select>
          </label>
        ) : null}
        {step === 4 ? (
          <div className="onboarding-options">
            {(["efectivo", "spei", "tarjeta", "mercadopago", "cod", "credito"] as const).map((method) => (
              <label key={method} className="onboarding-option">
                <input name={method} type="checkbox" defaultChecked={form[method]} />
                {paymentLabels[method]}
              </label>
            ))}
          </div>
        ) : null}
        {step === 5 ? (
          <>
            <dl className="onboarding-summary">
              <div><dt>{t("onboarding.company")}</dt><dd>{form.tradeName || form.legalName}<small>{form.legalName} · {form.rfc}</small></dd></div>
              <div><dt>{t("onboarding.branch")}</dt><dd>{form.locationName}<small>{form.state} · {form.locationPostalCode || form.fiscalPostalCode}</small></dd></div>
              <div><dt>{t("onboarding.tax")}</dt><dd>IVA {Number(form.vatRate) * 100}%</dd></div>
              <div><dt>{t("onboarding.payments")}</dt><dd>{Object.keys(paymentLabels).filter((key) => form[key as keyof typeof form] === true).map((key) => paymentLabels[key]).join(", ") || t("onboarding.noPayments")}</dd></div>
            </dl>
            <label className="onboarding-option">
              <input name="seedDemo" type="checkbox" defaultChecked={form.seedDemo} />
              {t("onboarding.seed")}
            </label>
            <label className="onboarding-option">
              <input name="privacyAccepted" type="checkbox" required defaultChecked={form.privacyAccepted} />
              <span>{t("onboarding.privacy")} <Link to="/aviso-de-privacidad" target="_blank" rel="noopener noreferrer">{t("onboarding.viewPrivacy")}</Link></span>
            </label>
          </>
        ) : null}
        </fieldset>
        {error ? <Notice tone="error" title={t("onboarding.errorTitle")}>{error}</Notice> : null}
        <div className="onboarding-actions">
          {step > 1 ? <BackButton onClick={back} disabled={saving} /> : null}
          <button className="primary" type="submit" disabled={saving} aria-busy={saving}>{saving ? t(step === 5 ? "onboarding.creating" : "common.loading") : step === 5 ? t("onboarding.submit") : t("common.continue")}</button>
        </div>
      </form>}
      {!created && auth.token && auth.user ? <div className="onboarding-account">
        <p>{t("onboarding.activeAccount")} <strong>{auth.user.email}</strong></p>
        <LogoutButton className="onboarding-restart" redirectTo="/registro" disabled={saving}>{t("onboarding.restartAccount")}</LogoutButton>
      </div> : null}
    </main>
  );
}
