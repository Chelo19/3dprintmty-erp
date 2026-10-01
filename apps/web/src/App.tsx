import { canAccessModule, canAccessPath, roleHome, MX_STATES, MX_TAX_REGIMES, Money, STOCK_UOMS, UOM_LABELS, canEditFiscalSettings, canReadSalePrice, canWriteLocations, roleLabel, uomShort } from "@3dprintmty/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "./api";
import { useAuth, type SessionUser } from "./auth";
import { ProductionDetailPage, ProductionPage, RecipesPage } from "./factory";
import { CollectionsPage, CustomerDetailPage, CustomerEditPage, CustomerNewPage, CustomersPage, DeleteButton, EditLink, FormActions, money, NewLink, OrderDetailPage, OrderNewPage, OrdersPage, PaymentNewPage, QuoteDetailPage, QuoteEditPage, QuoteNewPage, QuotesPage, RecordActions, SaveButton, ServiceDetailPage, ServiceEditPage, ServiceNewPage, ServicesPage } from "./operations";
import { InventoryPage } from "./inventory";
import { FilamentAdjustPage } from "./filament-stock";
import { CostCalculatorPage, clearCalculatorDraft, type CalculatorDraft } from "./costing";
import { FilterBar, FilterSelect, NoMatches, StatusBadge, distinct, matchesStatus, matchesText, useFilters } from "./filters";
import { CostOnly, CostPriceFields, MarginValue, ProfitValue } from "./margin";
import { ExpenseNewPage, ExpensePage, PrefacturaPage, PrefacturasPage, PurchaseOrderPage, PurchasingPage } from "./purchasing";
import { CardsSkeleton, DetailSkeleton, FormSkeleton, TableSkeleton } from "./skeleton";
import { Paged } from "./pager";
import { canWritePath, homeFor, useRole } from "./roles";
import { InvitePage, TeamPage } from "./team";
import { authErrorMessage, registerWithPassword, signInWithGoogle, signInWithPassword, supabase } from "./supabase";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Gate />} />
      <Route path="/entrar" element={<AuthPage mode="login" />} />
      <Route path="/registro" element={<AuthPage mode="register" />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/alta" element={<OnboardingPage />} />
      <Route path="/invitacion/:token" element={<InvitePage />} />
      <Route path="/aviso-de-privacidad" element={<PrivacyPage />} />
      <Route path="/app" element={<Shell />}>
        <Route index element={<DashboardPage />} />
        <Route path="productos" element={<ProductsPage />} />
        <Route path="productos/nuevo" element={<ProductNewPage />} />
        <Route path="productos/:id/editar" element={<ProductEditPage />} />
        <Route path="productos/:id" element={<ProductDetailPage />} />
        <Route path="filamentos" element={<FilamentsPage />} />
        <Route path="filamentos/nuevo" element={<FilamentNewPage />} />
        <Route path="filamentos/:id/editar" element={<FilamentEditPage />} />
        <Route path="filamentos/:id" element={<FilamentDetailPage />} />
        <Route path="insumos" element={<SuppliesPage />} />
        <Route path="insumos/nuevo" element={<ProductNewPage kind="component" />} />
        <Route path="insumos/:id" element={<ProductDetailPage />} />
        <Route path="insumos/:id/editar" element={<ProductEditPage />} />
        <Route path="inventario" element={<Navigate to="/app/inventario/filamentos" replace />} />
        <Route path="inventario/:section" element={<InventoryPage />} />
        <Route path="inventario/filamentos/:id/ajustar" element={<FilamentAdjustPage />} />
        <Route path="rollos/*" element={<Navigate to="/app/inventario/filamentos" replace />} />
        <Route path="costeo" element={<CostCalculatorPage />} />
        <Route path="servicios" element={<ServicesPage />} />
        <Route path="servicios/nuevo" element={<ServiceNewPage />} />
        <Route path="servicios/:id/editar" element={<ServiceEditPage />} />
        <Route path="servicios/:id" element={<ServiceDetailPage />} />
        <Route path="clientes" element={<CustomersPage />} />
        <Route path="clientes/nuevo" element={<CustomerNewPage />} />
        <Route path="clientes/:id/editar" element={<CustomerEditPage />} />
        <Route path="clientes/:id" element={<CustomerDetailPage />} />
        <Route path="cotizaciones" element={<QuotesPage />} />
        <Route path="cotizaciones/nueva" element={<QuoteNewPage />} />
        <Route path="cotizaciones/:id/editar" element={<QuoteEditPage />} />
        <Route path="cotizaciones/:id" element={<QuoteDetailPage />} />
        <Route path="pedidos" element={<OrdersPage />} />
        <Route path="pedidos/nuevo" element={<OrderNewPage />} />
        <Route path="pedidos/:id" element={<OrderDetailPage />} />
        <Route path="cobranza" element={<CollectionsPage />} />
        <Route path="cobranza/nuevo" element={<PaymentNewPage />} />
        <Route path="prefacturas" element={<PrefacturasPage />} />
        <Route path="prefacturas/:id" element={<PrefacturaPage />} />
        <Route path="manufactura" element={<Navigate to="/app/produccion" replace />} />
        <Route path="produccion" element={<ProductionPage />} />
        <Route path="produccion/:id" element={<ProductionDetailPage />} />
        <Route path="recetas" element={<RecipesPage />} />
        <Route path="calidad" element={<Navigate to="/app/produccion" replace />} />
        <Route path="compras" element={<PurchasingPage />} />
        <Route path="compras/nuevo" element={<ExpenseNewPage />} />
        <Route path="compras/gastos/:id" element={<ExpensePage />} />
        <Route path="compras/:id" element={<PurchaseOrderPage />} />
        <Route path="sucursales" element={<LocationsPage />} />
        <Route path="equipo" element={<TeamPage />} />
        <Route path="configuracion" element={<SettingsPage />} />
        <Route path="plataforma" element={<PlatformPage />} />
      </Route>
    </Routes>
  );
}

function readField(data: FormData, key: string, fallback: string) {
  const value = data.get(key);
  return typeof value === "string" ? value : fallback;
}

function Gate() {
  const { token, user } = useAuth();
  if (!token || !user) return <Navigate to="/entrar" replace />;
  return <Navigate to={homeFor(user)} replace />;
}

function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
      setError(caught instanceof ApiError ? caught.message : t("common.loading"));
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
      setError(caught instanceof Error ? caught.message : t("common.loading"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="main" style={{ maxWidth: 440 }}>
      <p className="brand">{t("app.name")}</p>
      <p>{t("app.tagline")}</p>
      <form className="card" onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <h1>{mode === "login" ? t("auth.login") : t("auth.register")}</h1>
        <label>
          {t("auth.email")}
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          {t("auth.password")}
          <input name="password" type="password" required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button className="primary" type="submit" disabled={busy !== null} aria-busy={busy === "login"}>
          {mode === "login" ? t("auth.login") : t("auth.register")}
        </button>
        {supabase ? (
          <>
            <p style={{ margin: 0, textAlign: "center", color: "var(--color-muted)" }}>{t("auth.or")}</p>
            <button className="ghost" type="button" disabled={busy !== null} aria-busy={busy === "google"} onClick={() => void onGoogle()}>
              {t("auth.google")}
            </button>
          </>
        ) : null}
        <Link to={mode === "login" ? "/registro" : "/entrar"}>
          {mode === "login" ? t("auth.noAccount") : t("auth.hasAccount")}
        </Link>
      </form>
    </main>
  );
}

function AuthCallback() {
  const { t } = useTranslation();
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const description = params.get("error_description");
    if (description) setError(description);
  }, []);

  if (error) {
    return (
      <main className="main" style={{ maxWidth: 440 }}>
        <p className="error">{error}</p>
        <Link to="/entrar">{t("auth.login")}</Link>
      </main>
    );
  }
  if (auth.token && auth.user) {
    return <Navigate to={homeFor(auth.user)} replace />;
  }
  return (
    <main className="main" style={{ maxWidth: 440 }}>
      <p>{t("common.loading")}</p>
    </main>
  );
}

function OnboardingPage() {
  const { t } = useTranslation();
  const auth = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(auth.token ? 1 : 0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    email: "",
    password: "",
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

  if (!auth.token && step > 0) return <Navigate to="/registro" replace />;

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
          await auth.adoptSupabaseSession();
          setStep(1);
          return;
        }
        const result = await api<{ token: string; user: SessionUser }>("/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        auth.setSession(result.token, result.user);
        setStep(1);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : "No se pudo crear la cuenta.");
      } finally {
        setSaving(false);
      }
      return;
    }
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const draft = {
      ...form,
      legalName: readField(data, "legalName", form.legalName),
      tradeName: readField(data, "tradeName", form.tradeName),
      rfc: readField(data, "rfc", form.rfc),
      taxRegime: readField(data, "taxRegime", form.taxRegime),
      fiscalPostalCode: readField(data, "fiscalPostalCode", form.fiscalPostalCode),
      state: readField(data, "state", form.state),
      locationName: readField(data, "locationName", form.locationName),
      locationPostalCode: readField(data, "locationPostalCode", form.locationPostalCode),
      vatRate: readField(data, "vatRate", form.vatRate),
      seedDemo: step === 5 ? data.has("seedDemo") : form.seedDemo,
      privacyAccepted: step === 5 ? data.has("privacyAccepted") : form.privacyAccepted,
    };
    if (step === 4) {
      draft.efectivo = data.has("efectivo");
      draft.spei = data.has("spei");
      draft.tarjeta = data.has("tarjeta");
      draft.mercadopago = data.has("mercadopago");
      draft.cod = data.has("cod");
      draft.credito = data.has("credito");
    }
    if (step < 5) {
      setForm(draft);
      setStep(step + 1);
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
      navigate("/app");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo crear el taller.");
    } finally {
      setSaving(false);
    }
  }

  const steps = [t("onboarding.account"), t("onboarding.company"), t("onboarding.branch"), t("onboarding.tax"), t("onboarding.payments"), t("onboarding.demo")];

  return (
    <main className="main" style={{ maxWidth: 640 }}>
      <p className="brand">{t("app.name")}</p>
      <h1>{t("onboarding.title")}</h1>
      <p>{steps[step]}</p>
      <form className="card" onSubmit={next} style={{ display: "grid", gap: 12 }}>
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
            <label>{t("onboarding.postalCode")}<input name="fiscalPostalCode" required pattern="\d{5}" defaultValue={form.fiscalPostalCode} /></label>
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
            <label>{t("onboarding.postalCode")}<input name="locationPostalCode" required pattern="\d{5}" defaultValue={form.locationPostalCode} /></label>
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
          <fieldset style={{ display: "grid", gap: 8 }}>
            {(["efectivo", "spei", "tarjeta", "mercadopago", "cod", "credito"] as const).map((method) => (
              <label key={method} style={{ gridTemplateColumns: "auto 1fr", alignItems: "center" }}>
                <input name={method} type="checkbox" defaultChecked={form[method]} />
                {method.toUpperCase()}
              </label>
            ))}
          </fieldset>
        ) : null}
        {step === 5 ? (
          <>
            <label style={{ gridTemplateColumns: "auto 1fr", alignItems: "center" }}>
              <input name="seedDemo" type="checkbox" defaultChecked={form.seedDemo} />
              {t("onboarding.seed")}
            </label>
            <label style={{ gridTemplateColumns: "auto 1fr", alignItems: "start" }}>
              <input name="privacyAccepted" type="checkbox" required defaultChecked={form.privacyAccepted} />
              <span>{t("onboarding.privacy")} <Link to="/aviso-de-privacidad">Aviso</Link></span>
            </label>
          </>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
        <div style={{ display: "flex", gap: 8 }}>
          {step > 0 ? <button className="ghost" type="button" onClick={() => setStep(step - 1)}>{t("common.back")}</button> : null}
          <button className="primary" type="submit" disabled={saving} aria-busy={saving}>{step === 5 ? t("onboarding.submit") : t("common.continue")}</button>
        </div>
      </form>
    </main>
  );
}

function Shell() {
  const { t } = useTranslation();
  const auth = useAuth();
  const location = useLocation();
  const formCanvas = /\/(nuevo|nueva|editar)(\/|$)/.test(location.pathname);
  const at = (...paths: string[]) => paths.some((path) => location.pathname.startsWith(path));
  const role = useRole();
  // Producción no ve precios de venta; prefacturas, cobranza y compras quedarían vacías o prohibidas.
  const seesMoney = canAccessModule(role, "sales");
  if (!auth.token || !auth.user) return <Navigate to="/entrar" replace />;
  if (!auth.user.tenantId && !auth.user.platformAdmin) return <Navigate to={homeFor(auth.user)} replace />;
  return (
    <div className={formCanvas ? "shell form-canvas" : "shell"}>
      <aside className="sidebar">
        <div>
          <p className="brand">{t("app.name")}</p>
          <p style={{ margin: 0, opacity: 0.7 }}>{auth.user.email}</p>
          {auth.user.role ? <p style={{ margin: 0, opacity: 0.7, fontSize: 13 }}>{roleLabel(auth.user.role)}</p> : null}
        </div>
        <nav className="side-nav">
          <Nav to="/app">{t("nav.home")}</Nav>
          <NavGroup label="Ventas" open={at("/app/clientes", "/app/cotizaciones", "/app/pedidos")}>
            <Nav to="/app/clientes">{t("nav.customers")}</Nav>
            <Nav to="/app/cotizaciones">{t("nav.quotes")}</Nav>
            <Nav to="/app/pedidos">{t("nav.orders")}</Nav>
          </NavGroup>
          {seesMoney ? (
            <NavGroup label="Finanzas" open={at("/app/prefacturas", "/app/cobranza")}>
              <Nav to="/app/prefacturas">{t("nav.preinvoices")}</Nav>
              <Nav to="/app/cobranza">{t("nav.collections")}</Nav>
            </NavGroup>
          ) : null}
          <NavGroup label="Fabricación" open={at("/app/produccion", "/app/recetas")}>
            <Nav to="/app/produccion">{t("nav.production")}</Nav>
            <Nav to="/app/recetas">Recetas</Nav>
          </NavGroup>
          <NavGroup label="Catálogo" open={at("/app/productos", "/app/insumos", "/app/filamentos", "/app/servicios", "/app/costeo")}>
            <Nav to="/app/productos">Productos</Nav>
            <Nav to="/app/insumos">Insumos</Nav>
            <Nav to="/app/filamentos">Filamentos</Nav>
            <Nav to="/app/servicios">Servicios</Nav>
            <Nav to="/app/costeo">Calculadora de costo</Nav>
          </NavGroup>
          <NavGroup label="Inventario" open={at("/app/inventario")}>
            <Nav to="/app/inventario/productos">Productos</Nav>
            <Nav to="/app/inventario/insumos">Insumos</Nav>
            <Nav to="/app/inventario/filamentos">Filamentos</Nav>
          </NavGroup>
          {canAccessModule(role, "purchasing") ? <Nav to="/app/compras">{t("nav.purchasing")}</Nav> : null}
          <NavGroup label={t("nav.settings")} open={at("/app/configuracion", "/app/sucursales", "/app/equipo", "/app/plataforma")}>
            <Nav to="/app/configuracion">{t("settings.title")}</Nav>
            <Nav to="/app/sucursales">{t("nav.locations")}</Nav>
            <Nav to="/app/equipo">{t("nav.team")}</Nav>
            {auth.user.platformAdmin && !auth.user.impersonator ? <Nav to="/app/plataforma">{t("nav.platform")}</Nav> : null}
          </NavGroup>
        </nav>
        <button className="ghost" type="button" onClick={() => { auth.logout(); }} style={{ color: "inherit", marginTop: "auto" }}>
          {t("common.logout")}
        </button>
      </aside>
      <div>
        {auth.user.impersonator ? <SupportBanner /> : null}
        <main className="main">
          {location.pathname === "/app/plataforma"
            ? auth.user.platformAdmin && !auth.user.impersonator ? <Outlet /> : <Navigate to={roleHome(role)} replace />
            : !canAccessPath(role, location.pathname) || (/\/(nuevo|nueva|editar|ajustar)(\/|$)/.test(location.pathname) && !canWritePath(role, location.pathname))
              ? role ? <Navigate to={roleHome(role)} replace /> : <p className="error">No tienes un rol válido para acceder al taller.</p>
              : <Outlet />}
        </main>
      </div>
    </div>
  );
}

function Nav({ to, children }: { to: string; children: ReactNode }) {
  const auth = useAuth();
  const role = useRole();
  if (to === "/app/plataforma" ? !auth.user?.platformAdmin || !!auth.user.impersonator : !canAccessPath(role, to)) return null;
  return <NavLink className="nav-link" to={to} end={to === "/app"}>{children}</NavLink>;
}

function NavGroup({ label, open, children }: { label: string; open: boolean; children: ReactNode }) {
  const [expanded, setExpanded] = useState(open);
  useEffect(() => {
    if (open) setExpanded(true);
  }, [open]);
  const role = useRole();
  const auth = useAuth();
  const links = (Array.isArray(children) ? children : [children]) as Array<{ props?: { to?: string } } | null>;
  if (!links.some((child) => child?.props?.to && (child.props.to === "/app/plataforma" ? auth.user?.platformAdmin && !auth.user.impersonator : canAccessPath(role, child.props.to)))) return null;
  return (
    <div className="nav-group">
      <button className="nav-group-label" type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
        <span>{label}</span>
        <span className={expanded ? "nav-chevron open" : "nav-chevron"} aria-hidden="true" />
      </button>
      {expanded ? <div className="nav-sub">{children}</div> : null}
    </div>
  );
}

function SupportBanner() {
  const auth = useAuth();
  const navigate = useNavigate();
  return (
    <div className="banner" style={{ margin: 16 }}>
      Sesión de soporte activa.
      <button
        className="ghost"
        type="button"
        style={{ marginLeft: 12 }}
        onClick={async () => {
          if (supabase) {
            await api("/platform/impersonate/stop", { method: "POST" });
            const { data } = await supabase.auth.getSession();
            const access = data.session?.access_token;
            if (!access) {
              auth.logout();
              navigate("/entrar");
              return;
            }
            const me = await api<{ user: SessionUser }>("/auth/me", {
              headers: { authorization: `Bearer ${access}` },
            });
            auth.setSession(access, me.user);
            navigate("/app/plataforma");
            return;
          }
          const result = await api<{ token: string }>("/platform/impersonate/stop", { method: "POST" });
          const me = await api<{ user: SessionUser }>("/auth/me", { headers: { authorization: `Bearer ${result.token}` } });
          auth.setSession(result.token, me.user);
          navigate("/app/plataforma");
        }}
      >
        Salir de soporte
      </button>
    </div>
  );
}

type Dashboard = {
  company: { legalName: string; rfc: string } | null;
  seeMoney: boolean;
  kpis: {
    collectedThisMonth: string | null;
    collectedLastMonth: string | null;
    expensesThisMonth: string | null;
    expensesLastMonth: string | null;
    receivables: string | null;
    payables: string | null;
    openQuotes: number;
    openQuotesValue: string | null;
    openOrders: number;
    openOrdersValue: string | null;
  };
  months: Array<{ key: string; collected: string | null; expenses: string | null }>;
  pipeline: Array<{ status: "pending" | "confirmed" | "in_production" | "ready_to_ship" | "on_hold"; count: number }>;
  operations: {
    ordersLate: number;
    ordersReadyToShip: number;
    productionOpen: number;
    productionLate: number;
    qcHold: number;
    purchasesIncoming: number;
    lowStock: number;
  };
};

function DashboardPage() {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<Dashboard>("/dashboard"),
  });
  if (query.isPending) {
    return (
      <section style={{ display: "grid", gap: 16 }}>
        <header>
          <h1>{t("dashboard.title")}</h1>
          <span className="skeleton" style={{ width: 280, height: 16 }} />
        </header>
        <CardsSkeleton count={4} />
        <CardsSkeleton count={4} />
      </section>
    );
  }
  if (!query.data) return <p className="error">No se pudo cargar el inicio.</p>;
  const { company, seeMoney, kpis, months, pipeline, operations } = query.data;
  const attention = [
    attentionRow(t("dashboard.lateOrders"), operations.ordersLate, "/app/pedidos", "bad"),
    attentionRow(t("dashboard.productionLate"), operations.productionLate, "/app/produccion", "bad"),
    attentionRow(t("dashboard.qcHold"), operations.qcHold, "/app/produccion", "bad"),
    attentionRow(t("dashboard.lowStock"), operations.lowStock, "/app/inventario/filamentos", "bad"),
    attentionRow(t("dashboard.readyToShip"), operations.ordersReadyToShip, "/app/pedidos", "good"),
    attentionRow(t("dashboard.productionOpen"), operations.productionOpen, "/app/produccion", "info"),
    attentionRow(t("dashboard.purchasesIncoming"), operations.purchasesIncoming, "/app/compras", "wait"),
  ];
  const pipelineLabel: Record<Dashboard["pipeline"][number]["status"], string> = {
    pending: t("dashboard.pending"),
    confirmed: t("dashboard.confirmed"),
    in_production: t("dashboard.inProduction"),
    ready_to_ship: t("dashboard.readyToShip"),
    on_hold: t("dashboard.onHold"),
  };
  const pipelineMax = Math.max(1, ...pipeline.map((row) => row.count));
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <header>
        <h1>{t("dashboard.title")}</h1>
        <p>{company ? `${company.legalName} · RFC ${company.rfc}` : null}</p>
      </header>
      {seeMoney ? (
        <div className="kpi-grid">
          <Kpi to="/app/cobranza" tone="in" label={t("dashboard.collected")} value={money(kpis.collectedThisMonth)} hint={`${t("dashboard.lastMonth")} ${money(kpis.collectedLastMonth)}`} />
          <Kpi to="/app/pedidos" tone={Number(kpis.receivables) > 0 ? "due" : "ok"} label={t("dashboard.receivables")} value={money(kpis.receivables)} hint={t("dashboard.receivablesHint")} />
          <Kpi to="/app/compras" tone="cost" label={t("dashboard.expenses")} value={money(kpis.expensesThisMonth)} hint={`${t("dashboard.lastMonth")} ${money(kpis.expensesLastMonth)}`} />
          <Kpi to="/app/compras" tone={Number(kpis.payables) > 0 ? "owe" : "ok"} label={t("dashboard.payables")} value={money(kpis.payables)} hint={t("dashboard.payablesHint")} />
        </div>
      ) : null}
      {seeMoney ? (
        <article className="card dashboard-chart">
          <header>
            <strong>{t("dashboard.chart")}</strong>
            <span>{t("dashboard.chartHint")}</span>
          </header>
          <MonthBars months={months} collectedLabel={t("dashboard.collectedSeries")} expensesLabel={t("dashboard.expensesSeries")} />
        </article>
      ) : null}
      <div className="dashboard-split">
        <article className="card">
          <strong>{t("dashboard.attention")}</strong>
          <div className="attention-list">
            {attention.map((row) => (
              <Link key={row.label} to={row.to} className={`attention-row ${row.tone}`}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </Link>
            ))}
          </div>
        </article>
        <article className="card">
          <strong>{t("dashboard.pipeline")}</strong>
          <p className="kpi-hint">{kpis.openOrders} · {seeMoney ? money(kpis.openOrdersValue) : t("dashboard.openOrders")}</p>
          <div className="pipeline">
            {pipeline.map((row) => (
              <div key={row.status} className={`pipeline-row ${row.status}`}>
                <span>{pipelineLabel[row.status]}</span>
                <span className="pipeline-track">
                  <span style={{ width: `${(row.count / pipelineMax) * 100}%` }} />
                  <span className="chart-tip" role="tooltip">{pipelineLabel[row.status]}: {row.count}</span>
                </span>
                <strong>{row.count}</strong>
              </div>
            ))}
          </div>
          <Link to="/app/cotizaciones" className="attention-row" style={{ marginTop: 8 }}>
            <span>{t("dashboard.openQuotes")}</span>
            <strong>{kpis.openQuotes}{seeMoney ? ` · ${money(kpis.openQuotesValue)}` : ""}</strong>
          </Link>
        </article>
      </div>
    </section>
  );
}

type KpiTone = "in" | "due" | "cost" | "owe" | "ok";
type AttentionTone = "bad" | "good" | "info" | "wait" | "calm";

function attentionRow(label: string, value: number, to: string, whenActive: Exclude<AttentionTone, "calm">) {
  return { label, value, to, tone: value > 0 ? whenActive : "calm" as AttentionTone };
}

function Kpi({ to, label, value, hint, tone }: { to: string; label: string; value: string; hint: string; tone: KpiTone }) {
  return (
    <Link to={to} className={`card kpi ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{hint}</em>
    </Link>
  );
}

const MONTH_LABELS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function MonthBars({
  months,
  collectedLabel,
  expensesLabel,
}: {
  months: Dashboard["months"];
  collectedLabel: string;
  expensesLabel: string;
}) {
  const max = Math.max(1, ...months.flatMap((month) => [Number(month.collected ?? 0), Number(month.expenses ?? 0)]));
  return (
    <>
      <div className="chart-legend">
        <span><i className="swatch collected" />{collectedLabel}</span>
        <span><i className="swatch spent" />{expensesLabel}</span>
      </div>
      <div className="month-chart">
        {months.map((month) => {
          const collected = Number(month.collected ?? 0);
          const spent = Number(month.expenses ?? 0);
          const name = MONTH_LABELS[Number(month.key.slice(5, 7)) - 1] ?? month.key;
          return (
            <div key={month.key} className="month-col">
              <div className="month-bars">
                <span className="month-bar collected" style={{ height: `${(collected / max) * 100}%` }} />
                <span className="month-bar spent" style={{ height: `${(spent / max) * 100}%` }} />
                <span className="chart-tip" role="tooltip">
                  <strong>{name} {month.key.slice(0, 4)}</strong>
                  <span><i className="swatch collected" />{collectedLabel} {money(month.collected)}</span>
                  <span><i className="swatch spent" />{expensesLabel} {money(month.expenses)}</span>
                </span>
              </div>
              <span className="month-label">{name}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function ProductsPage() {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["products"],
    queryFn: () => api<{ data: Product[]; total: number }>("/products?limit=100"),
  });
  const { values, set, reset, dirty } = useFilters({ q: "", estado: "active", tipo: "" });
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>{t("products.title")}</h1>
        <NewLink to="/app/productos/nuevo">{t("products.create")}</NewLink>
      </div>
      <p>{t("products.hint")}</p>
      {query.isPending ? <TableSkeleton columns={9} /> : (() => {
        const goods = (query.data?.data ?? []).filter((product) => product.productType === "finished_good" || product.productType === "resale");
        if (!goods.length) return <p>{t("products.empty")}</p>;
        const bySearch = goods.filter((product) =>
          matchesText(values.q, product.sku, product.name) && (!values.tipo || product.productType === values.tipo));
        const rows = bySearch.filter((product) => matchesStatus(product.status, values.estado));
        return (
        <>
        <FilterBar
          search={values.q}
          onSearch={(value) => set("q", value)}
          placeholder="SKU o nombre"
          status={values.estado}
          onStatus={(value) => set("estado", value)}
          hiddenInactive={values.estado === "active" ? bySearch.length - rows.length : 0}
          dirty={dirty}
          onClear={reset}
        >
          <FilterSelect
            label="Tipo"
            value={values.tipo}
            onChange={(value) => set("tipo", value)}
            options={[{ value: "finished_good", label: "Producto terminado" }, { value: "resale", label: "Producto revendido" }]}
          />
        </FilterBar>
        {!rows.length ? <NoMatches onClear={reset} /> : (
        <Paged rows={rows}>
        {(pageGoods) => (
        <table>
          <thead>
            <tr>
              <th>{t("products.sku")}</th>
              <th>{t("products.name")}</th>
              <th>Tipo</th>
              <th>Unidad</th>
              <CostOnly><th>{t("products.cost")}</th></CostOnly>
              <th>{t("products.sale")}</th>
              <CostOnly><th>{t("products.profit")}</th></CostOnly>
              <CostOnly><th>{t("products.margin")}</th></CostOnly>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pageGoods.map((product) => (
              <tr key={product.id}>
                <td>{product.sku}</td>
                <td>{product.name}</td>
                <td>{PRODUCT_TYPE[product.productType] ?? product.productType}</td>
                <td>{uomShort(product.stockUom)}</td>
                <CostOnly><td>{product.cost ? Money.fromMajor(product.cost).format("es-MX") : "—"}</td></CostOnly>
                <td>{product.pricesHidden ? t("products.hidden") : product.salePrice ? Money.fromMajor(product.salePrice).format("es-MX") : "—"}</td>
                <CostOnly><td>{product.pricesHidden ? t("products.hidden") : <ProfitValue cost={product.cost} price={product.salePrice} />}</td></CostOnly>
                <CostOnly><td>{product.pricesHidden ? t("products.hidden") : <MarginValue cost={product.cost} price={product.salePrice} />}</td></CostOnly>
                <td><StatusBadge status={product.status} /></td>
                <td><RecordActions detailTo={`/app/productos/${product.id}`} editTo={`/app/productos/${product.id}/editar`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
        </Paged>
        )}
        </>
        );
      })()}
    </section>
  );
}

function SuppliesPage() {
  const query = useQuery({
    queryKey: ["products"],
    queryFn: () => api<{ data: Product[]; total: number }>("/products?limit=100"),
  });
  const { values, set, reset, dirty } = useFilters({ q: "", estado: "active", uom: "" });
  const supplies = (query.data?.data ?? []).filter((product) => product.productType === "component");
  const bySearch = supplies.filter((product) =>
    matchesText(values.q, product.sku, product.name) && (!values.uom || product.stockUom === values.uom));
  const rows = bySearch.filter((product) => matchesStatus(product.status, values.estado));
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Insumos</h1>
        <NewLink to="/app/insumos/nuevo">Nuevo insumo</NewLink>
      </div>
      <p>Herrajes y materiales que se compran. El filamento tiene su propio catálogo.</p>
      {query.isPending ? <TableSkeleton columns={8} /> : !supplies.length ? <p>Todavía no hay insumos.</p> : (
        <>
        <FilterBar
          search={values.q}
          onSearch={(value) => set("q", value)}
          placeholder="SKU o nombre"
          status={values.estado}
          onStatus={(value) => set("estado", value)}
          hiddenInactive={values.estado === "active" ? bySearch.length - rows.length : 0}
          dirty={dirty}
          onClear={reset}
        >
          <FilterSelect
            label="Unidad"
            value={values.uom}
            onChange={(value) => set("uom", value)}
            options={distinct(supplies.map((product) => product.stockUom)).map((uom) => ({ value: uom, label: uomShort(uom) }))}
            allLabel="Todas"
          />
        </FilterBar>
        {!rows.length ? <NoMatches onClear={reset} /> : (
        <Paged rows={rows}>
        {(pageSupplies) => (
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Nombre</th>
              <th>Unidad</th>
              <CostOnly><th>Costo</th></CostOnly>
              <th>Precio de venta</th>
              <CostOnly><th>Margen de utilidad</th></CostOnly>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pageSupplies.map((product) => (
              <tr key={product.id}>
                <td>{product.sku}</td>
                <td>{product.name}</td>
                <td>{uomShort(product.stockUom)}</td>
                <CostOnly><td>{product.cost ? Money.fromMajor(product.cost).format("es-MX") : "—"}</td></CostOnly>
                <td>{product.pricesHidden ? "Oculto para tu rol" : product.salePrice ? Money.fromMajor(product.salePrice).format("es-MX") : "—"}</td>
                <CostOnly><td>{product.pricesHidden ? "Oculto para tu rol" : <MarginValue cost={product.cost} price={product.salePrice} />}</td></CostOnly>
                <td><StatusBadge status={product.status} /></td>
                <td><RecordActions detailTo={`/app/insumos/${product.id}`} editTo={`/app/insumos/${product.id}/editar`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
        </Paged>
        )}
        </>
      )}
    </section>
  );
}

function FilamentsPage() {
  const query = useQuery({
    queryKey: ["filaments"],
    queryFn: () => api<{ data: Filament[] }>("/filaments"),
  });
  const { values, set, reset, dirty } = useFilters({ q: "", estado: "active", material: "", color: "" });
  const filaments = query.data?.data ?? [];
  const bySearch = filaments.filter((product) =>
    matchesText(values.q, product.sku, product.name, product.material, product.color)
    && (!values.material || product.material === values.material)
    && (!values.color || product.color === values.color));
  const rows = bySearch.filter((product) => matchesStatus(product.status, values.estado));

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Filamentos</h1>
        <NewLink to="/app/filamentos/nuevo">Nuevo filamento</NewLink>
      </div>
      <p>Se guardan en gramos y se compran por kilogramo. El precio de venta es por gramo usado: 10 g a $0.48 son $4.80 antes de IVA.</p>
      {query.isPending ? <TableSkeleton columns={10} /> : !filaments.length ? <p>Todavía no hay filamentos.</p> : (
        <>
        <FilterBar
          search={values.q}
          onSearch={(value) => set("q", value)}
          placeholder="SKU, nombre, material o color"
          status={values.estado}
          onStatus={(value) => set("estado", value)}
          hiddenInactive={values.estado === "active" ? bySearch.length - rows.length : 0}
          dirty={dirty}
          onClear={reset}
        >
          <FilterSelect
            label="Material"
            value={values.material}
            onChange={(value) => set("material", value)}
            options={distinct(filaments.map((product) => product.material)).map((material) => ({ value: material, label: material }))}
          />
          <FilterSelect
            label="Color"
            value={values.color}
            onChange={(value) => set("color", value)}
            options={distinct(filaments.map((product) => product.color)).map((color) => ({ value: color, label: color }))}
          />
        </FilterBar>
        {!rows.length ? <NoMatches onClear={reset} /> : (
        <Paged rows={rows}>
        {(pageFilaments) => (
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Nombre</th>
              <th>Material</th>
              <th>Color</th>
              <th>Diámetro</th>
              <CostOnly><th>Costo por kg</th></CostOnly>
              <th>Precio por gramo</th>
              <CostOnly><th>Margen de utilidad</th></CostOnly>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pageFilaments.map((product) => (
              <tr key={product.id}>
                <td>{product.sku}</td>
                <td>{product.name}</td>
                <td>{product.material}</td>
                <td>{product.color}</td>
                <td>{product.diameterMm}</td>
                <CostOnly><td>{product.cost ? Money.fromMajor(product.cost).format("es-MX") : "—"}</td></CostOnly>
                <td>{product.pricesHidden ? "Oculto para tu rol" : product.salePrice ? Money.fromMajor(product.salePrice).format("es-MX") : "—"}</td>
                <CostOnly><td>{product.pricesHidden ? "Oculto para tu rol" : <MarginValue cost={product.cost} price={product.salePrice} divisor={1000} />}</td></CostOnly>
                <td><StatusBadge status={product.status} /></td>
                <td><RecordActions detailTo={`/app/filamentos/${product.id}`} editTo={`/app/filamentos/${product.id}/editar`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
        </Paged>
        )}
        </>
      )}
    </section>
  );
}

interface Product {
  id: string;
  sku: string;
  name: string;
  productType: string;
  status?: string;
  stockUom: string;
  purchaseUom: string;
  cost: string | null;
  salePrice: string | null;
  pricesHidden: boolean;
}

interface Filament {
  id: string;
  sku: string;
  name: string;
  status?: string;
  material: string;
  color: string;
  diameterMm: string;
  cost: string | null;
  salePrice: string | null;
  pricesHidden: boolean;
}

const PRODUCT_TYPE: Record<string, string> = {
  component: "Insumo",
  finished_good: "Producto terminado",
  resale: "Producto revendido",
};

function catalogHome(productType: string) {
  return productType === "component" ? "/app/insumos" : "/app/productos";
}

function ProductDetailPage() {
  const { id } = useParams();
  const product = useQuery({ queryKey: ["product", id], queryFn: () => api<Product>(`/products/${id}`) });
  if (product.isPending) return <DetailSkeleton />;
  if (!product.data) return <p className="error">No se pudo cargar el producto.</p>;
  const data = product.data;
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <p><Link to={catalogHome(data.productType)}>{data.productType === "component" ? "Insumos" : "Productos"}</Link></p>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>{data.name}</h1>
        <EditLink to={`${catalogHome(data.productType)}/${data.id}/editar`} />
      </div>
      <article className="card">
        <p>SKU {data.sku} · {PRODUCT_TYPE[data.productType] ?? data.productType} · {data.status === "inactive" ? "Inactivo" : "Activo"}</p>
        <p>Unidad de medida {UOM_LABELS[data.stockUom as keyof typeof UOM_LABELS] ?? data.stockUom}</p>
        <CostOnly><p>Costo {data.cost ? Money.fromMajor(data.cost).format("es-MX") : "—"}</p></CostOnly>
        <p>Precio {data.pricesHidden ? "Oculto para tu rol" : data.salePrice ? Money.fromMajor(data.salePrice).format("es-MX") : "—"}</p>
        <CostOnly><p style={{ margin: 0 }}>Margen de utilidad {data.pricesHidden ? "Oculto para tu rol" : <MarginValue cost={data.cost} price={data.salePrice} />}</p></CostOnly>
      </article>
      <CostOnly>{data.productType === "finished_good" ? <p style={{ margin: 0 }}><Link to={`/app/costeo?producto=${data.id}`}>Calcular costo</Link></p> : null}</CostOnly>
    </section>
  );
}

function ProductEditPage() {
  const { id } = useParams();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const product = useQuery({ queryKey: ["product", id], queryFn: () => api<Product>(`/products/${id}`) });
  const save = useMutation({
    mutationFn: (body: unknown) => api(`/products/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  });
  if (product.isPending) return <FormSkeleton fields={6} />;
  if (!product.data) return <p className="error">No se pudo cargar el producto.</p>;
  const data = product.data;
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <p><Link to={`${catalogHome(data.productType)}/${id}`}>{data.productType === "component" ? "Insumo" : "Producto"}</Link></p>
      <h1>{data.productType === "component" ? "Editar insumo" : "Editar producto"}</h1>
      <form
        className="card form-vertical"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setError(null);
          void save.mutateAsync({
            sku: String(form.get("sku") || "").trim(),
            name: form.get("name"),
            stockUom: form.get("stockUom"),
            cost: String(form.get("cost") || "") || null,
            salePrice: String(form.get("salePrice") || "") || null,
            status: form.get("status"),
          }).then(async () => {
            await client.invalidateQueries({ queryKey: ["products"] });
            await client.invalidateQueries({ queryKey: ["product", id] });
            navigate(`${catalogHome(data.productType)}/${id}`);
          }).catch((caught) => setError(caught instanceof ApiError ? caught.message : "No se pudo guardar."));
        }}
      >
        <label>SKU<input name="sku" required maxLength={40} defaultValue={data.sku} style={{ textTransform: "uppercase" }} /></label>
        <label>Nombre<input name="name" required defaultValue={data.name} /></label>
        <UomSelect defaultValue={data.stockUom} hint="Si ya hay existencia, déjala en cero antes de cambiar la unidad: las cantidades no se convierten. Revisa también las recetas que lo usen." />
        <CostPriceFields costLabel="Costo" priceLabel="Precio de venta" initialCost={data.cost ?? ""} initialPrice={data.salePrice ?? ""} />
        <label>
          Estado
          <select name="status" defaultValue={data.status ?? "active"}>
            <option value="active">Activo</option>
            <option value="inactive">Inactivo</option>
          </select>
        </label>
        <FormActions>
          <SaveButton pending={save.isPending} />
          <DeleteButton
            pending={save.isPending}
            onClick={() => {
              const noun = data.productType === "component" ? "insumo" : "producto";
              if (!window.confirm(`¿Eliminar este ${noun}? Esta acción no se puede deshacer.`)) return;
              setError(null);
              void api(`/products/${id}`, { method: "DELETE" }).then(async () => {
                await client.invalidateQueries({ queryKey: ["products"] });
                navigate(catalogHome(data.productType));
              }).catch((caught) => setError(caught instanceof ApiError ? caught.message : "No se pudo eliminar."));
            }}
          />
          {error ? <p className="error">{error}</p> : null}
        </FormActions>
      </form>
    </section>
  );
}

function FilamentDetailPage() {
  const { id } = useParams();
  const filament = useQuery({ queryKey: ["filament", id], queryFn: () => api<Filament>(`/filaments/${id}`) });
  if (filament.isPending) return <DetailSkeleton />;
  if (!filament.data) return <p className="error">No se pudo cargar el filamento.</p>;
  const data = filament.data;
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <p><Link to="/app/filamentos">Filamentos</Link></p>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>{data.name}</h1>
        <EditLink to={`/app/filamentos/${data.id}/editar`} />
      </div>
      <article className="card">
        <p>SKU {data.sku} · {data.material} · {data.color} · {data.diameterMm} mm · {data.status === "inactive" ? "Inactivo" : "Activo"}</p>
        <CostOnly><p>Costo por kg {data.cost ? Money.fromMajor(data.cost).format("es-MX") : "—"}</p></CostOnly>
        <p>Precio por gramo {data.pricesHidden ? "Oculto para tu rol" : data.salePrice ? Money.fromMajor(data.salePrice).format("es-MX") : "—"}</p>
        <CostOnly><p style={{ margin: 0 }}>Margen de utilidad {data.pricesHidden ? "Oculto para tu rol" : <MarginValue cost={data.cost} price={data.salePrice} divisor={1000} />}</p></CostOnly>
      </article>
    </section>
  );
}

function FilamentEditPage() {
  const { id } = useParams();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const filament = useQuery({ queryKey: ["filament", id], queryFn: () => api<Filament>(`/filaments/${id}`) });
  if (filament.isPending) return <FormSkeleton fields={8} />;
  if (!filament.data) return <p className="error">No se pudo cargar el filamento.</p>;
  const data = filament.data;
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <p><Link to={`/app/filamentos/${id}`}>Filamento</Link></p>
      <h1>Editar filamento</h1>
      <form
        className="card form-vertical"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setError(null);
          setSaving(true);
          void api(`/filaments/${id}`, {
            method: "PATCH",
            body: JSON.stringify({
              sku: String(form.get("sku") || "").trim(),
              name: form.get("name"),
              material: form.get("material"),
              color: form.get("color"),
              diameterMm: form.get("diameterMm"),
              cost: String(form.get("cost") || "") || null,
              salePrice: String(form.get("salePrice") || "") || null,
              status: form.get("status"),
            }),
          }).then(async () => {
            await client.invalidateQueries({ queryKey: ["filaments"] });
            await client.invalidateQueries({ queryKey: ["filament", id] });
            navigate(`/app/filamentos/${id}`);
          }).catch((caught) => setError(caught instanceof ApiError ? caught.message : "No se pudo guardar.")).finally(() => setSaving(false));
        }}
      >
        <label>SKU<input name="sku" required maxLength={40} defaultValue={data.sku} style={{ textTransform: "uppercase" }} /></label>
        <label>Nombre<input name="name" required defaultValue={data.name} /></label>
        <label>Material<input name="material" required defaultValue={data.material} /></label>
        <label>Color<input name="color" required defaultValue={data.color} /></label>
        <label>Diámetro<select name="diameterMm" defaultValue={data.diameterMm}><option>1.75</option><option>2.85</option></select></label>
        <CostPriceFields costLabel="Costo por kg" priceLabel="Precio por gramo" initialCost={data.cost ?? ""} initialPrice={data.salePrice ?? ""} divisor={1000} />
        <label>
          Estado
          <select name="status" defaultValue={data.status ?? "active"}>
            <option value="active">Activo</option>
            <option value="inactive">Inactivo</option>
          </select>
        </label>
        <FormActions>
          <SaveButton pending={saving} />
          <DeleteButton
            pending={saving}
            onClick={() => {
              if (!window.confirm("¿Eliminar este filamento? Esta acción no se puede deshacer.")) return;
              setError(null);
              setSaving(true);
              void api(`/filaments/${id}`, { method: "DELETE" }).then(async () => {
                await client.invalidateQueries({ queryKey: ["filaments"] });
                navigate("/app/filamentos");
              }).catch((caught) => setError(caught instanceof ApiError ? caught.message : "No se pudo eliminar.")).finally(() => setSaving(false));
            }}
          />
          {error ? <p className="error">{error}</p> : null}
        </FormActions>
      </form>
    </section>
  );
}

function UomSelect({ defaultValue, hint }: { defaultValue: string; hint?: string }) {
  return (
    <label>
      Unidad de medida
      <select name="stockUom" defaultValue={defaultValue}>
        {STOCK_UOMS.map((uom) => <option key={uom} value={uom}>{UOM_LABELS[uom]}</option>)}
      </select>
      {hint ? <span className="costing-hint">{hint}</span> : null}
    </label>
  );
}

function ProductNewPage({ kind }: { kind?: "component" }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const supply = kind === "component";
  const draft = supply ? undefined : (location.state as { calculator?: CalculatorDraft } | null)?.calculator;
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [productType, setProductType] = useState(kind ?? "finished_good");
  const [saveRecipe, setSaveRecipe] = useState(true);
  const create = useMutation({
    mutationFn: (body: unknown) => api<{ id: string }>("/products", { method: "POST", body: JSON.stringify(body) }),
  });
  const withRecipe = Boolean(draft?.recipe.length) && saveRecipe && productType === "finished_good";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);
    let created: { id: string };
    try {
      created = await create.mutateAsync({
        sku: String(data.get("sku")),
        name: String(data.get("name")),
        productType,
        stockUom: String(data.get("stockUom") || "EA"),
        cost: String(data.get("cost")),
        salePrice: String(data.get("salePrice") || "") || undefined,
      });
      await client.invalidateQueries({ queryKey: ["products"] });
      await client.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo guardar.");
      return;
    }
    if (withRecipe && draft) {
      try {
        await api("/boms", {
          method: "POST",
          body: JSON.stringify({
            productId: created.id,
            notes: "Desde la calculadora de costo",
            lines: draft.recipe.map((line) => ({ componentProductId: line.componentProductId, quantity: line.quantity })),
          }),
        });
        await client.invalidateQueries({ queryKey: ["boms"] });
      } catch (caught) {
        setCreatedId(created.id);
        setError(`El producto se guardó, pero la receta no: ${caught instanceof ApiError ? caught.message : "error desconocido"}.`);
        return;
      }
    }
    if (draft) {
      clearCalculatorDraft();
      navigate(`/app/productos/${created.id}`);
      return;
    }
    navigate(supply ? "/app/insumos" : "/app/productos");
  }

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <p>
        <Link to={supply ? "/app/insumos" : "/app/productos"}>{supply ? "Insumos" : t("products.title")}</Link>
        {draft ? <> · <Link to="/app/costeo">Volver a la calculadora</Link></> : null}
      </p>
      <h1>{supply ? "Nuevo insumo" : "Nuevo producto"}</h1>
      <form className="card form-vertical" onSubmit={onSubmit}>
        {draft ? <CostOnly><p style={{ margin: 0 }}>Costo y precio vienen de la calculadora. Ajusta el precio si quieres otro margen.</p></CostOnly> : null}
        <label>{t("products.sku")}<input name="sku" required /></label>
        <label>{t("products.name")}<input name="name" required defaultValue={draft?.name} /></label>
        {supply ? null : (
          <label>
            {t("products.type")}
            <select value={productType} onChange={(event) => setProductType(event.target.value)}>
              <option value="finished_good">Producto terminado</option>
              <option value="resale">Producto revendido</option>
            </select>
          </label>
        )}
        <UomSelect defaultValue="EA" />
        <CostPriceFields costLabel="Costo" priceLabel={t("products.sale")} costPlaceholder="35.00" pricePlaceholder="480.00" costRequired initialCost={draft?.cost} initialPrice={draft?.salePrice} />
        {draft && draft.recipe.length > 0 && productType === "finished_good" ? (
          <fieldset className="payment-terms">
            <legend>Receta</legend>
            <label className="payment-terms-wide" style={{ gridTemplateColumns: "auto 1fr", alignItems: "center" }}>
              <input type="checkbox" checked={saveRecipe} onChange={(event) => setSaveRecipe(event.target.checked)} />
              Guardar la receta con {draft.recipe.length === 1 ? "este material" : `estos ${draft.recipe.length} materiales`} por pieza
            </label>
            <ul className="payment-terms-wide" style={{ margin: 0, paddingLeft: 18 }}>
              {draft.recipe.map((line) => <li key={line.componentProductId}>{line.name} · {line.quantity} {line.uom}</li>)}
            </ul>
            {draft.services ? <p className="payment-terms-wide muted-note">Los servicios cuentan en el costo, pero no van en la receta.</p> : null}
          </fieldset>
        ) : null}
        <FormActions>
          <SaveButton pending={create.isPending || Boolean(createdId)} label={supply ? "Guardar insumo" : "Guardar producto"} />
          {createdId ? <Link to={`/app/productos/${createdId}`}>Ver el producto</Link> : null}
          {error ? <p className="error">{error}</p> : null}
        </FormActions>
      </form>
    </section>
  );
}

function FilamentNewPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (body: unknown) => api("/filaments", { method: "POST", body: JSON.stringify(body) }),
  });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);
    try {
      await create.mutateAsync({
        sku: String(data.get("sku")),
        name: String(data.get("name")),
        material: String(data.get("material")),
        color: String(data.get("color")),
        diameterMm: String(data.get("diameterMm")),
        cost: String(data.get("cost")),
        salePrice: String(data.get("salePrice") || "") || undefined,
      });
      await client.invalidateQueries({ queryKey: ["filaments"] });
      navigate("/app/filamentos");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo guardar.");
    }
  }

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <p><Link to="/app/filamentos">Filamentos</Link></p>
      <h1>Nuevo filamento</h1>
      <p>Se guarda en gramos y se compra por kilogramo. El precio de venta es por gramo usado.</p>
      <form className="card form-vertical" onSubmit={onSubmit}>
        <label>SKU<input name="sku" required /></label>
        <label>Nombre<input name="name" required /></label>
        <label>Material<input name="material" defaultValue="PLA" required /></label>
        <label>Color<input name="color" required /></label>
        <label>Diámetro<select name="diameterMm" defaultValue="1.75"><option>1.75</option><option>2.85</option></select></label>
        <CostPriceFields costLabel="Costo por kg" priceLabel="Precio de venta por gramo" costPlaceholder="250.00" pricePlaceholder="0.48" costRequired divisor={1000} />
        <FormActions>
          <SaveButton pending={create.isPending} label="Guardar filamento" />
          {error ? <p className="error">{error}</p> : null}
        </FormActions>
      </form>
    </section>
  );
}

function LocationsPage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [saving, setSaving] = useState(false);
  const query = useQuery({
    queryKey: ["locations"],
    queryFn: () => api<Array<{ id: string; name: string; state: string; postalCode: string; kind: string }>>("/locations"),
  });
  const role = useRole();
  const canEdit = role !== null && canWriteLocations(role);
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>{t("nav.locations")}</h1>
      {canEdit ? (
      <form
        className="card form-vertical"
        onSubmit={async (event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
          const form = new FormData(formElement);
          setSaving(true);
          try {
            await api("/locations", {
              method: "POST",
              body: JSON.stringify({
                name: form.get("name"),
                state: form.get("state"),
                postalCode: form.get("postalCode"),
                kind: "warehouse",
              }),
            });
            formElement.reset();
            await client.invalidateQueries({ queryKey: ["locations"] });
          } finally {
            setSaving(false);
          }
        }}
      >
        <label>Nombre<input name="name" required /></label>
        <label>
          {t("onboarding.state")}
          <select name="state">{MX_STATES.map((state) => <option key={state}>{state}</option>)}</select>
        </label>
        <label>{t("onboarding.postalCode")}<input name="postalCode" required pattern="\d{5}" /></label>
        <FormActions>
          <SaveButton pending={saving} label="Agregar ubicación" />
        </FormActions>
      </form>
      ) : <p style={{ margin: 0 }}>Solo el dueño, un administrador o almacén pueden agregar ubicaciones.</p>}
      {query.isPending ? <TableSkeleton columns={1} rows={4} /> : (
      <ul>
        {query.data?.map((location) => (
          <li key={location.id}>{location.name} · {location.state} · CP {location.postalCode}</li>
        ))}
      </ul>
      )}
    </section>
  );
}

function SettingsPage() {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const company = useQuery({
    queryKey: ["company"],
    queryFn: () => api<{
      legalName: string;
      tradeName: string;
      rfc: string;
      taxRegime: string;
      fiscalPostalCode: string;
      vatRate: string;
    }>("/company"),
  });
  const role = useRole();
  if (company.isPending) return <FormSkeleton fields={6} />;
  if (!company.data) return <p className="error">No se pudo cargar la configuración.</p>;
  const canEdit = role !== null && canEditFiscalSettings(role);
  const canPreview = role !== null && ["owner", "admin", "sales"].includes(role);
  const initialVat = company.data.vatRate.startsWith("0.08") ? "0.08" : company.data.vatRate.startsWith("0.00") ? "0" : "0.16";
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>{t("settings.title")}</h1>
      {canEdit ? null : <p style={{ margin: 0 }}>Solo el dueño del taller puede cambiar los datos fiscales. Aquí puedes consultarlos.</p>}
      <form
        className="card form-vertical"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setError(null);
          setBusy("save");
          try {
            await api("/company", {
              method: "PATCH",
              body: JSON.stringify({
                legalName: form.get("legalName"),
                tradeName: form.get("tradeName"),
                rfc: form.get("rfc"),
                taxRegime: form.get("taxRegime"),
                fiscalPostalCode: form.get("fiscalPostalCode"),
                vatRate: form.get("vatRate"),
              }),
            });
            await company.refetch();
          } catch (caught) {
            setError(caught instanceof ApiError ? caught.message : "No se pudo guardar.");
          } finally {
            setBusy(null);
          }
        }}
      >
        <fieldset disabled={!canEdit} style={{ display: "contents" }}>
        <label>{t("onboarding.legalName")}<input name="legalName" defaultValue={company.data.legalName} required /></label>
        <label>{t("onboarding.tradeName")}<input name="tradeName" defaultValue={company.data.tradeName ?? ""} /></label>
        <label>{t("onboarding.rfc")}<input name="rfc" defaultValue={company.data.rfc} required /></label>
        <label>
          {t("onboarding.regime")}
          <select name="taxRegime" defaultValue={company.data.taxRegime}>
            {MX_TAX_REGIMES.map((regime) => <option key={regime.code} value={regime.code}>{regime.code} — {regime.label}</option>)}
          </select>
        </label>
        <label>{t("onboarding.postalCode")}<input name="fiscalPostalCode" defaultValue={company.data.fiscalPostalCode} required pattern="\d{5}" /></label>
        <label>
          {t("onboarding.vat")}
          <select name="vatRate" defaultValue={initialVat}>
            <option value="0.16">IVA 16%</option>
            <option value="0.08">IVA 8% frontera</option>
            <option value="0">Tasa 0</option>
          </select>
        </label>
        </fieldset>
        {canEdit ? (
          <FormActions>
            <SaveButton pending={busy !== null} />
            {error ? <p className="error">{error}</p> : null}
          </FormActions>
        ) : null}
      </form>
      {canPreview ? (
      <form
        className="card form-vertical"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setBusy("preview");
          try {
            const result = await api<{ tax: string; total: string }>("/tax/preview", {
            method: "POST",
            body: JSON.stringify({
              lines: [{ description: "Vista previa", quantity: "1", unitPrice: String(form.get("amount")) }],
              rate: String(form.get("rate") ?? "0.16"),
            }),
          });
          setPreview(`IVA ${Money.fromMajor(result.tax).format("es-MX")} · Total ${Money.fromMajor(result.total).format("es-MX")}`);
          } finally {
            setBusy(null);
          }
        }}
      >
        <h2>{t("settings.preview")}</h2>
        <label>{t("settings.amount")}<input name="amount" defaultValue="100.00" required /></label>
        <input type="hidden" name="rate" value={initialVat} />
        <button className="ghost" type="submit" disabled={busy !== null} aria-busy={busy === "preview"}>{t("settings.preview")}</button>
        {preview ? <p>{preview}</p> : null}
      </form>
      ) : null}
    </section>
  );
}

function PlatformPage() {
  const { t } = useTranslation();
  const auth = useAuth();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ["platform-tenants"],
    queryFn: () => api<{ data: Array<{ id: string; legalName: string | null; rfc: string; status: string }> }>("/platform/tenants"),
  });
  const [entering, setEntering] = useState<string | null>(null);
  return (
    <section style={{ display: "grid", gap: 12 }}>
      <h1>{t("platform.title")}</h1>
      {query.isPending ? <CardsSkeleton count={3} /> : query.data?.data.map((tenant) => (
        <article key={tenant.id} className="card" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <strong>{tenant.legalName}</strong>
            <p style={{ margin: 0 }}>{tenant.rfc} · {tenant.status}</p>
          </div>
          <button
            className="primary"
            type="button"
            disabled={entering !== null}
            aria-busy={entering === tenant.id}
            onClick={async () => {
              setEntering(tenant.id);
              try {
                const result = await api<{ token: string }>("/platform/impersonate", {
                  method: "POST",
                  body: JSON.stringify({ tenantId: tenant.id }),
                });
                auth.setSession(result.token, {
                  ...(auth.user as SessionUser),
                  tenantId: tenant.id,
                  role: "admin",
                  impersonator: auth.user?.id ?? null,
                });
                navigate("/app");
              } finally {
                setEntering(null);
              }
            }}
          >
            {t("platform.enter")}
          </button>
        </article>
      ))}
    </section>
  );
}

function PrivacyPage() {
  const { t } = useTranslation();
  return (
    <main className="main" style={{ maxWidth: 680 }}>
      <h1>{t("privacy.title")}</h1>
      <p>{t("privacy.body")}</p>
      <Link to="/alta">Volver</Link>
    </main>
  );
}
