import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "./api";
import { Notice } from "./notice";
import { money } from "./operations";

export type Dashboard = {
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
    lowStock: number;
  };
};

export function DashboardPage() {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/dashboard") });
  if (query.isPending) return (
    <section className="dashboard-page" aria-busy="true" aria-label={t("dashboard.loading")}>
      <header className="dashboard-heading"><h1>{t("dashboard.title")}</h1><span className="skeleton" style={{ width: 200, height: 16 }} /></header>
      <div className="dashboard-finances">{Array.from({ length: 4 }, (_, index) => <div className="dashboard-metric" key={index}><span className="skeleton" style={{ width: 90, height: 14 }} /><span className="skeleton" style={{ height: 30 }} /><span className="skeleton" style={{ width: 130, height: 12 }} /></div>)}</div>
      <div className="dashboard-work"><div className="skeleton" style={{ height: 320 }} /><div className="skeleton" style={{ height: 320 }} /></div>
    </section>
  );
  if (query.isError || !query.data) return <section className="dashboard-page"><h1>{t("dashboard.title")}</h1><Notice tone="error" title={t("dashboard.loadError")} action={<button className="ghost" type="button" onClick={() => query.refetch()}>{t("dashboard.retry")}</button>}>{query.error?.message ?? t("dashboard.loadErrorHint")}</Notice></section>;
  const { company, seeMoney, kpis, months, pipeline, operations } = query.data;
  const priorities = [
    { label: t("dashboard.lateOrders"), value: operations.ordersLate, to: "/app/pedidos" },
    { label: t("dashboard.productionLate"), value: operations.productionLate, to: "/app/produccion" },
    { label: t("dashboard.qcHold"), value: operations.qcHold, to: "/app/produccion" },
    { label: t("dashboard.lowStock"), value: operations.lowStock, to: "/app/inventario/filamentos" },
  ];
  const activity = [
    { label: t("dashboard.readyToShip"), value: operations.ordersReadyToShip, to: "/app/pedidos?estado=ready_to_ship" },
    { label: t("dashboard.productionOpen"), value: operations.productionOpen, to: "/app/produccion" },
  ];
  const labels: Record<Dashboard["pipeline"][number]["status"], string> = {
    pending: t("dashboard.pending"), confirmed: t("dashboard.confirmed"), in_production: t("dashboard.inProduction"),
    ready_to_ship: t("dashboard.readyToShip"), on_hold: t("dashboard.onHold"),
  };
  return (
    <section className="dashboard-page">
      <header className="dashboard-heading">
        <h1>{t("dashboard.title")}</h1>
        {company ? <div className="dashboard-business"><span>{company.legalName}</span><span>RFC {company.rfc}</span></div> : null}
      </header>
      {seeMoney ? <div className="dashboard-finances" aria-label={t("dashboard.finances")}>
        <Metric to="/app/cobranza" label={t("dashboard.collected")} value={kpis.collectedThisMonth} hint={`${t("dashboard.lastMonth")} ${amount(kpis.collectedLastMonth)}`} />
        <Metric to="/app/compras" label={t("dashboard.expenses")} value={kpis.expensesThisMonth} hint={`${t("dashboard.lastMonth")} ${amount(kpis.expensesLastMonth)}`} />
        <Metric to="/app/pedidos" label={t("dashboard.receivables")} value={kpis.receivables} hint={t("dashboard.receivablesHint")} />
        <Metric to="/app/compras" label={t("dashboard.payables")} value={kpis.payables} hint={t("dashboard.payablesHint")} />
      </div> : null}
      <div className="dashboard-work">
        <section className="dashboard-panel" aria-labelledby="dashboard-operation-heading">
          <h2 id="dashboard-operation-heading">{t("dashboard.workshop")}</h2>
          <h3 className="dashboard-subheading">{t("dashboard.attention")}</h3>
          <div className="dashboard-priorities">
            {priorities.map((row) => <Link key={row.label} to={row.to} className={`dashboard-priority ${row.value ? "has-pending" : ""}`}><strong>{row.value}</strong><span>{row.label}</span></Link>)}
          </div>
          {priorities.every((row) => row.value === 0) ? <p className="dashboard-clear">{t("dashboard.clear")}</p> : null}
          <h3 className="dashboard-subheading">{t("dashboard.activity")}</h3>
          <div className="dashboard-activity">
            {activity.map((row) => <Link key={row.label} to={row.to}><span>{row.label}</span><strong>{row.value}</strong><span aria-hidden="true">→</span></Link>)}
          </div>
        </section>
        <section className="dashboard-panel dashboard-orders" aria-labelledby="dashboard-orders-heading">
          <header className="dashboard-panel-heading"><h2 id="dashboard-orders-heading">{t("dashboard.pipeline")}</h2><Link to="/app/pedidos">{t("dashboard.viewOrders")}</Link></header>
          <div className="dashboard-order-total"><strong>{kpis.openOrders}</strong><span>{t("dashboard.openOrders")}{seeMoney ? <small>{amount(kpis.openOrdersValue)}</small> : null}</span></div>
          <div className="dashboard-order-states">
            {pipeline.map((row) => <Link key={row.status} to={`/app/pedidos?estado=${row.status}`}><span>{labels[row.status]}</span><strong>{row.count}</strong></Link>)}
          </div>
          <Link to="/app/cotizaciones" className="dashboard-quotes"><span>{t("dashboard.openQuotes")}{seeMoney ? <small>{amount(kpis.openQuotesValue)}</small> : null}</span><strong>{kpis.openQuotes}</strong><span aria-hidden="true">→</span></Link>
        </section>
      </div>
      {seeMoney ? <section className="dashboard-panel dashboard-history" aria-labelledby="dashboard-history-heading">
        <header><h2 id="dashboard-history-heading">{t("dashboard.chart")}</h2><p>{t("dashboard.chartHint")}</p></header>
        <MonthChart months={months} />
      </section> : null}
    </section>
  );
}

function amount(value: string | null) { return value === null ? "-" : money(value); }
function Metric({ to, label, value, hint }: { to: string; label: string; value: string | null; hint: string }) {
  return <Link to={to} className="dashboard-metric"><span>{label}</span><strong>{amount(value)}</strong><small>{hint}</small></Link>;
}

function chartCeiling(value: number) {
  if (value <= 0) return 0;
  const base = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 5, 10].find((step) => step * base >= value) ?? 10) * base;
}

function MonthChart({ months }: { months: Dashboard["months"] }) {
  const { t, i18n } = useTranslation();
  const [selectedKey, setSelectedKey] = useState("");
  const detailId = useId();
  const selected = months.find((month) => month.key === selectedKey) ?? months.at(-1);
  const values = months.flatMap((month) => [Number(month.collected ?? 0), Number(month.expenses ?? 0)]);
  const high = chartCeiling(Math.max(0, ...values));
  const negativeExtent = chartCeiling(-Math.min(0, ...values));
  const low = negativeExtent > 0 ? -negativeExtent : 0;
  const range = high - low || 1;
  const locale = (i18n.resolvedLanguage ?? i18n.language ?? "es-MX").startsWith("en") ? "en-US" : "es-MX";
  const label = (key: string, full = false) => {
    const date = new Date(`${key}-01T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return key;
    const formatted = date.toLocaleDateString(locale, { month: full ? "long" : "short", ...(full ? { year: "numeric" } : {}), timeZone: "UTC" });
    return full ? formatted.charAt(0).toUpperCase() + formatted.slice(1) : formatted;
  };
  if (!selected || !values.some((value) => value !== 0)) return <div className="dashboard-history-empty"><p>{t("dashboard.emptyHistory")}</p><Link to="/app/cobranza">{t("dashboard.viewCollections")}</Link></div>;
  const ticks = [high, (high + low) / 2, low];
  return <figure className="dashboard-figure">
    <div className="dashboard-chart-legend"><span><i className="dashboard-swatch collected" />{t("dashboard.collectedSeries")}</span><span><i className="dashboard-swatch spent" />{t("dashboard.expensesSeries")}</span></div>
    <div className="dashboard-plot">
      <div className="dashboard-chart-axis" aria-hidden="true">{ticks.map((tick, index) => <span key={index}>{new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(tick)}</span>)}</div>
      <div className="dashboard-chart-columns" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
        <div className="dashboard-chart-guides" aria-hidden="true"><span /><span /><span />{low < 0 ? <span className="dashboard-chart-zero" style={{ top: `${high / range * 100}%` }} /> : null}</div>
        {months.map((month) => <button key={month.key} type="button" className={`dashboard-month ${selected.key === month.key ? "is-selected" : ""}`}
          aria-pressed={selected.key === month.key} aria-describedby={selected.key === month.key ? detailId : undefined}
          aria-label={`${label(month.key, true)}: ${t("dashboard.collectedSeries")} ${amount(month.collected)}, ${t("dashboard.expensesSeries")} ${amount(month.expenses)}`}
          onClick={() => setSelectedKey(month.key)}>
          <span className="dashboard-month-bars" aria-hidden="true">
            {[month.collected, month.expenses].map((value, index) => <span key={index} className={`dashboard-month-bar ${index === 0 ? "collected" : "spent"}`} style={{ height: `${Math.abs(Number(value ?? 0)) / range * 100}%`, bottom: `${(Number(value ?? 0) >= 0 ? -low : Number(value ?? 0) - low) / range * 100}%` }} />)}
          </span>
          <span className="dashboard-month-label">{label(month.key)}</span>
        </button>)}
      </div>
    </div>
    <figcaption id={detailId} className="dashboard-chart-detail" aria-live="polite"><strong>{label(selected.key, true)}</strong><span>{t("dashboard.collectedSeries")} <b>{amount(selected.collected)}</b></span><span>{t("dashboard.expensesSeries")} <b>{amount(selected.expenses)}</b></span></figcaption>
  </figure>;
}
