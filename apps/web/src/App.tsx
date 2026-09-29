import { MX_STATES, MX_TAX_REGIMES, Money } from "@3dprintmty/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, Outlet, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "./api";
import { useAuth, type SessionUser } from "./auth";
import {
  CycleCountsPage,
  ManufacturingPage,
  ProductionDetailPage,
  ProductionPage,
  QualityPage,
  SpoolsPage,
} from "./factory";
import { CollectionsPage, CustomersPage, OrdersPage, QuoteDetailPage, QuoteNewPage, QuotesPage, ServicesPage } from "./operations";
import { MrpPage, PrefacturaPage, PrefacturasPage, PurchaseOrderPage, PurchasingPage } from "./purchasing";
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
        <Route path="filamentos" element={<FilamentsPage />} />
        <Route path="servicios" element={<ServicesPage />} />
        <Route path="clientes" element={<CustomersPage />} />
        <Route path="cotizaciones" element={<QuotesPage />} />
        <Route path="cotizaciones/nueva" element={<QuoteNewPage />} />
        <Route path="cotizaciones/:id" element={<QuoteDetailPage />} />
        <Route path="pedidos" element={<OrdersPage />} />
        <Route path="cobranza" element={<CollectionsPage />} />
        <Route path="prefacturas" element={<PrefacturasPage />} />
        <Route path="prefacturas/:id" element={<PrefacturaPage />} />
        <Route path="rollos" element={<SpoolsPage />} />
        <Route path="conteos" element={<CycleCountsPage />} />
        <Route path="manufactura" element={<ManufacturingPage />} />
        <Route path="produccion" element={<ProductionPage />} />
        <Route path="produccion/:id" element={<ProductionDetailPage />} />
        <Route path="calidad" element={<QualityPage />} />
        <Route path="compras" element={<PurchasingPage />} />
        <Route path="compras/:id" element={<PurchaseOrderPage />} />
        <Route path="mrp" element={<MrpPage />} />
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
  if (!user.tenantId) return <Navigate to="/alta" replace />;
  return <Navigate to="/app" replace />;
}

function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    setError(null);
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
        navigate(user.tenantId ? "/app" : "/alta");
        return;
      }
      const session = await api<{ token: string; user: SessionUser }>(
        mode === "login" ? "/auth/login" : "/auth/register",
        { method: "POST", body: JSON.stringify({ email, password }) },
      );
      auth.setSession(session.token, session.user);
      navigate(session.user.tenantId ? "/app" : "/alta");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("common.loading"));
    }
  }

  async function onGoogle() {
    setError(null);
    try {
      await signInWithGoogle();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("common.loading"));
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
        <button className="primary" type="submit">
          {mode === "login" ? t("auth.login") : t("auth.register")}
        </button>
        {supabase ? (
          <>
            <p style={{ margin: 0, textAlign: "center", color: "var(--color-muted)" }}>{t("auth.or")}</p>
            <button className="ghost" type="button" onClick={() => void onGoogle()}>
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
    return <Navigate to={auth.user.tenantId ? "/app" : "/alta"} replace />;
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
          <button className="primary" type="submit">{step === 5 ? t("onboarding.submit") : t("common.continue")}</button>
        </div>
      </form>
    </main>
  );
}

function Shell() {
  const { t } = useTranslation();
  const auth = useAuth();
  if (!auth.token || !auth.user) return <Navigate to="/entrar" replace />;
  if (!auth.user.tenantId && !auth.user.platformAdmin) return <Navigate to="/alta" replace />;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div>
          <p className="brand">{t("app.name")}</p>
          <p style={{ margin: 0, opacity: 0.7 }}>{auth.user.email}</p>
        </div>
        <nav className="side-nav">
          <Nav to="/app">{t("nav.home")}</Nav>
          <Nav to="/app/productos">{t("nav.products")}</Nav>
          <Nav to="/app/filamentos">{t("nav.filaments")}</Nav>
          <Nav to="/app/servicios">{t("nav.services")}</Nav>
          <Nav to="/app/clientes">{t("nav.customers")}</Nav>
          <Nav to="/app/cotizaciones">{t("nav.quotes")}</Nav>
          <Nav to="/app/pedidos">{t("nav.orders")}</Nav>
          <Nav to="/app/cobranza">{t("nav.collections")}</Nav>
          <Nav to="/app/prefacturas">{t("nav.preinvoices")}</Nav>
          <Nav to="/app/manufactura">{t("nav.manufacturing")}</Nav>
          <Nav to="/app/produccion">{t("nav.production")}</Nav>
          <Nav to="/app/calidad">{t("nav.quality")}</Nav>
          <Nav to="/app/compras">{t("nav.purchasing")}</Nav>
          <Nav to="/app/mrp">{t("nav.mrp")}</Nav>
          <Nav to="/app/rollos">{t("nav.spools")}</Nav>
          <Nav to="/app/conteos">{t("nav.counts")}</Nav>
          <Nav to="/app/sucursales">{t("nav.locations")}</Nav>
          <Nav to="/app/equipo">{t("nav.team")}</Nav>
          <Nav to="/app/configuracion">{t("nav.settings")}</Nav>
          {auth.user.platformAdmin && !auth.user.impersonator ? <Nav to="/app/plataforma">{t("nav.platform")}</Nav> : null}
        </nav>
        <button className="ghost" type="button" onClick={() => { auth.logout(); }} style={{ color: "inherit", marginTop: "auto" }}>
          {t("common.logout")}
        </button>
      </aside>
      <div>
        {auth.user.impersonator ? <SupportBanner /> : null}
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Nav({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="nav-link" to={to}>{children}</Link>;
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

function DashboardPage() {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<{
      company: { legalName: string; rfc: string; vatRate: string; currency: string; timezone: string; qcGate: string } | null;
      counts: { products: number; locations: number; members: number; orders: number; receivables: string };
      operations: Record<OperationMetric, number>;
    }>("/dashboard"),
  });
  if (!query.data) return <p>{t("common.loading")}</p>;
  const { company, counts, operations } = query.data;
  const gate: Record<string, string> = { off: "apagado", warn: "avisa", block: "bloquea" };
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <header>
        <h1>{t("dashboard.title")}</h1>
        <p>{company?.legalName} · RFC {company?.rfc} · IVA {company?.vatRate} · {company?.currency} · {company?.timezone}</p>
      </header>
      <div className="grid-cards">
        <Metric label={t("dashboard.products")} value={counts.products} />
        <Metric label={t("dashboard.locations")} value={counts.locations} />
        <Metric label={t("dashboard.members")} value={counts.members} />
        <Metric label={t("dashboard.orders")} value={counts.orders} />
        <Metric label={t("dashboard.receivables")} value={counts.receivables} />
      </div>
      <h2 style={{ margin: 0 }}>{t("dashboard.operations")}</h2>
      <div className="grid-cards">
        {OPERATION_METRICS.map(([key, to]) => (
          <Link key={key} to={to} style={{ color: "inherit", textDecoration: "none" }}>
            <Metric label={t(`dashboard.${key}`)} value={operations[key]} />
          </Link>
        ))}
      </div>
      <p style={{ margin: 0 }}>{t("dashboard.qcGate")}: {gate[company?.qcGate ?? "warn"]}</p>
      <div className="card">
        <strong>{t("dashboard.preinvoice")}</strong>
        <p>{t("dashboard.emptyOrders")}</p>
      </div>
    </section>
  );
}

type OperationMetric =
  | "productionOpen"
  | "qcHold"
  | "purchasesIncoming"
  | "spoolsActive"
  | "spoolsLow"
  | "mrpPlanned"
  | "prefacturasThisMonth";

const OPERATION_METRICS: Array<[OperationMetric, string]> = [
  ["productionOpen", "/app/produccion"],
  ["qcHold", "/app/calidad"],
  ["purchasesIncoming", "/app/compras"],
  ["mrpPlanned", "/app/mrp"],
  ["spoolsActive", "/app/rollos"],
  ["spoolsLow", "/app/rollos"],
  ["prefacturasThisMonth", "/app/prefacturas"],
];

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <article className="card">
      <p style={{ margin: 0, color: "var(--color-muted)" }}>{label}</p>
      <p style={{ fontFamily: "var(--font-serif)", fontSize: 36, margin: "8px 0 0" }}>{value}</p>
    </article>
  );
}

function ProductsPage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [productType, setProductType] = useState("finished_good");
  const query = useQuery({
    queryKey: ["products"],
    queryFn: () => api<{ data: Product[]; total: number }>("/products?limit=100"),
  });
  const create = useMutation({
    mutationFn: (body: unknown) => api("/products", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["products"] });
      await client.invalidateQueries({ queryKey: ["dashboard"] });
    },
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
        productType,
        cost: String(data.get("cost")),
        salePrice: String(data.get("salePrice") || "") || undefined,
      });
      form.reset();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo guardar.");
    }
  }

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>{t("products.title")}</h1>
      <p>{t("products.hint")}</p>
      <form className="card" onSubmit={onSubmit} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        <label>{t("products.sku")}<input name="sku" required /></label>
        <label>{t("products.name")}<input name="name" required /></label>
        <label>
          {t("products.type")}
          <select value={productType} onChange={(event) => setProductType(event.target.value)}>
            <option value="component">Insumo o herraje</option>
            <option value="finished_good">Producto terminado</option>
          </select>
        </label>
        <label>Costo por pieza<input name="cost" required placeholder="35.00" /></label>
        <label>{t("products.sale")}<input name="salePrice" placeholder="480.00" /></label>
        <button className="primary" type="submit">{t("products.create")}</button>
        {error ? <p className="error">{error}</p> : null}
      </form>
      {(() => {
        const goods = (query.data?.data ?? []).filter((product) => product.productType === "component" || product.productType === "finished_good");
        if (!goods.length) return <p>{t("products.empty")}</p>;
        return (
        <table>
          <thead>
            <tr>
              <th>{t("products.sku")}</th>
              <th>{t("products.name")}</th>
              <th>UOM</th>
              <th>{t("products.cost")}</th>
              <th>{t("products.sale")}</th>
            </tr>
          </thead>
          <tbody>
            {goods.map((product) => (
              <tr key={product.id}>
                <td>{product.sku}</td>
                <td>{product.name}</td>
                <td>{product.stockUom}/{product.purchaseUom}</td>
                <td>{product.cost ? Money.fromMajor(product.cost).format("es-MX") : "—"}</td>
                <td>{product.pricesHidden ? t("products.hidden") : product.salePrice ? Money.fromMajor(product.salePrice).format("es-MX") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        );
      })()}
    </section>
  );
}

function FilamentsPage() {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["products", "filaments"],
    queryFn: () => api<{ data: Product[]; total: number }>("/products?limit=100"),
  });
  const create = useMutation({
    mutationFn: (body: unknown) => api("/products", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["products"] });
    },
  });
  const filaments = (query.data?.data ?? []).filter((product) => product.productType === "raw_material");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);
    try {
      await create.mutateAsync({
        sku: String(data.get("sku")),
        name: String(data.get("name")),
        productType: "raw_material",
        material: String(data.get("material")),
        color: String(data.get("color")),
        diameterMm: String(data.get("diameterMm")),
        cost: String(data.get("cost")),
        salePrice: String(data.get("salePrice") || "") || undefined,
      });
      form.reset();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo guardar.");
    }
  }

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>Filamentos</h1>
      <p>Se guardan en gramos y se compran por kilogramo. El precio de venta es por gramo usado: 10 g a $0.48 son $4.80 antes de IVA.</p>
      <form className="card" onSubmit={onSubmit} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        <label>SKU<input name="sku" required /></label>
        <label>Nombre<input name="name" required /></label>
        <label>Material<input name="material" defaultValue="PLA" required /></label>
        <label>Color<input name="color" required /></label>
        <label>Diámetro<select name="diameterMm" defaultValue="1.75"><option>1.75</option><option>2.85</option></select></label>
        <label>Costo por kg<input name="cost" required placeholder="250.00" /></label>
        <label>Precio de venta por gramo<input name="salePrice" placeholder="0.48" /></label>
        <button className="primary" type="submit">Agregar filamento</button>
        {error ? <p className="error">{error}</p> : null}
      </form>
      {!filaments.length ? <p>Todavía no hay filamentos.</p> : (
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Nombre</th>
              <th>Material</th>
              <th>Color</th>
              <th>Diámetro</th>
              <th>Costo por kg</th>
              <th>Precio por gramo</th>
            </tr>
          </thead>
          <tbody>
            {filaments.map((product) => (
              <tr key={product.id}>
                <td>{product.sku}</td>
                <td>{product.name}</td>
                <td>{product.material ?? "—"}</td>
                <td>{product.color ?? "—"}</td>
                <td>{product.diameterMm ?? "—"}</td>
                <td>{product.cost ? Money.fromMajor(product.cost).format("es-MX") : "—"}</td>
                <td>{product.pricesHidden ? "Oculto para tu rol" : product.salePrice ? Money.fromMajor(product.salePrice).format("es-MX") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

interface Product {
  id: string;
  sku: string;
  name: string;
  productType: string;
  material: string | null;
  color: string | null;
  diameterMm: string | null;
  stockUom: string;
  purchaseUom: string;
  cost: string | null;
  salePrice: string | null;
  pricesHidden: boolean;
}

function LocationsPage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["locations"],
    queryFn: () => api<Array<{ id: string; name: string; state: string; postalCode: string; kind: string }>>("/locations"),
  });
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>{t("nav.locations")}</h1>
      <form
        className="card"
        style={{ display: "grid", gap: 10 }}
        onSubmit={async (event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
          const form = new FormData(formElement);
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
        }}
      >
        <label>Nombre<input name="name" required /></label>
        <label>
          {t("onboarding.state")}
          <select name="state">{MX_STATES.map((state) => <option key={state}>{state}</option>)}</select>
        </label>
        <label>{t("onboarding.postalCode")}<input name="postalCode" required pattern="\d{5}" /></label>
        <button className="primary" type="submit">{t("common.save")}</button>
      </form>
      <ul>
        {query.data?.map((location) => (
          <li key={location.id}>{location.name} · {location.state} · CP {location.postalCode}</li>
        ))}
      </ul>
    </section>
  );
}

function TeamPage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [link, setLink] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["team"],
    queryFn: () => api<{ members: Array<{ userId: string; email: string; role: string }> }>("/team"),
  });
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>{t("team.title")}</h1>
      <form
        className="card"
        style={{ display: "grid", gap: 10 }}
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const result = await api<{ acceptPath: string }>("/invitations", {
            method: "POST",
            body: JSON.stringify({ email: form.get("email"), role: form.get("role") }),
          });
          setLink(`${window.location.origin}${result.acceptPath}`);
          await client.invalidateQueries({ queryKey: ["team"] });
        }}
      >
        <label>{t("auth.email")}<input name="email" type="email" required /></label>
        <label>
          {t("team.role")}
          <select name="role">
            <option value="admin">admin</option>
            <option value="sales">sales</option>
            <option value="production">production</option>
            <option value="warehouse">warehouse</option>
            <option value="viewer">viewer</option>
          </select>
        </label>
        <button className="primary" type="submit">{t("team.invite")}</button>
      </form>
      {link ? <p className="banner">{t("team.link")} <a href={link}>{link}</a></p> : null}
      <ul>
        {query.data?.members.map((member) => (
          <li key={member.userId}>{member.email} · {member.role}</li>
        ))}
      </ul>
    </section>
  );
}

function SettingsPage() {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  if (!company.data) return <p>{t("common.loading")}</p>;
  const initialVat = company.data.vatRate.startsWith("0.08") ? "0.08" : company.data.vatRate.startsWith("0.00") ? "0" : "0.16";
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>{t("settings.title")}</h1>
      <form
        className="card"
        style={{ display: "grid", gap: 10 }}
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setError(null);
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
          }
        }}
      >
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
        {error ? <p className="error">{error}</p> : null}
        <button className="primary" type="submit">{t("common.save")}</button>
      </form>
      <form
        className="card"
        style={{ display: "grid", gap: 10 }}
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const result = await api<{ tax: string; total: string }>("/tax/preview", {
            method: "POST",
            body: JSON.stringify({
              lines: [{ description: "Vista previa", quantity: "1", unitPrice: String(form.get("amount")) }],
              rate: String(form.get("rate") ?? "0.16"),
            }),
          });
          setPreview(`IVA ${Money.fromMajor(result.tax).format("es-MX")} · Total ${Money.fromMajor(result.total).format("es-MX")}`);
        }}
      >
        <h2>{t("settings.preview")}</h2>
        <label>{t("settings.amount")}<input name="amount" defaultValue="100.00" required /></label>
        <input type="hidden" name="rate" value={initialVat} />
        <button className="ghost" type="submit">{t("settings.preview")}</button>
        {preview ? <p>{preview}</p> : null}
      </form>
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
  return (
    <section style={{ display: "grid", gap: 12 }}>
      <h1>{t("platform.title")}</h1>
      {query.data?.data.map((tenant) => (
        <article key={tenant.id} className="card" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <strong>{tenant.legalName}</strong>
            <p style={{ margin: 0 }}>{tenant.rfc} · {tenant.status}</p>
          </div>
          <button
            className="primary"
            type="button"
            onClick={async () => {
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
            }}
          >
            {t("platform.enter")}
          </button>
        </article>
      ))}
    </section>
  );
}

function InvitePage() {
  const { token } = useParams();
  const { t } = useTranslation();
  const auth = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="main" style={{ maxWidth: 460 }}>
      <h1>Aceptar invitación</h1>
      {supabase && !auth.token ? (
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <p style={{ margin: 0 }}>Entra con el correo de la invitación. Después podrás unirte al taller.</p>
          <button className="ghost" type="button" onClick={() => void signInWithGoogle().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "No se pudo entrar con Google."))}>
            {t("auth.google")}
          </button>
          <Link to="/entrar">Entrar con correo</Link>
          {error ? <p className="error">{error}</p> : null}
        </div>
      ) : (
      <form
        className="card"
        style={{ display: "grid", gap: 10 }}
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setError(null);
          try {
            const result = await api<{ token: string | null; user: { id: string; email: string; role: string | null; tenantId: string | null } }>(
              "/invitations/accept",
              {
                method: "POST",
                body: JSON.stringify(supabase ? { token } : { token, password: form.get("password") }),
              },
            );
            const nextToken = result.token ?? auth.token;
            if (!nextToken) throw new Error("No hay sesión.");
            auth.setSession(nextToken, {
              id: result.user.id,
              email: result.user.email,
              tenantId: result.user.tenantId,
              role: result.user.role,
              platformAdmin: auth.user?.platformAdmin ?? false,
              impersonator: null,
            });
            navigate("/app");
          } catch (caught) {
            setError(caught instanceof ApiError ? caught.message : "No se pudo aceptar.");
          }
        }}
      >
        {supabase ? null : <label>Contraseña<input name="password" type="password" minLength={8} required /></label>}
        {error ? <p className="error">{error}</p> : null}
        <button className="primary" type="submit">Unirme al taller</button>
      </form>
      )}
    </main>
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
