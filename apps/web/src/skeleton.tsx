import type { CSSProperties, ReactNode } from "react";

function Status({ children }: { children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Cargando</span>
      {children}
    </div>
  );
}

function Bar({ width = "100%", height = 14 }: { width?: CSSProperties["width"]; height?: number }) {
  return <span className="skeleton" style={{ width, height }} />;
}

export function TableSkeleton({ columns, rows = 6 }: { columns: number; rows?: number }) {
  return (
    <Status>
      <div className="skeleton-table">
        {Array.from({ length: rows }, (_, row) => (
          <div className="skeleton-row" key={row} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {Array.from({ length: columns }, (_, column) => (
              <Bar key={column} width={column === columns - 1 ? "70%" : undefined} />
            ))}
          </div>
        ))}
      </div>
    </Status>
  );
}

export function CardsSkeleton({ count }: { count: number }) {
  return (
    <Status>
      <div className="grid-cards">
        {Array.from({ length: count }, (_, index) => (
          <article className="card" key={index} style={{ display: "grid", gap: 12 }}>
            <Bar width="55%" />
            <Bar width="40%" height={32} />
          </article>
        ))}
      </div>
    </Status>
  );
}

export function DetailSkeleton() {
  return (
    <Status>
      <div style={{ display: "grid", gap: 16 }}>
        <Bar width={110} />
        <Bar width={260} height={28} />
        <article className="card" style={{ display: "grid", gap: 12 }}>
          <Bar width="72%" />
          <Bar width="48%" />
          <Bar width="36%" />
        </article>
      </div>
    </Status>
  );
}

export function CustomerSkeleton() {
  return (
    <Status>
      <div style={{ display: "grid", gap: 16 }}>
        <Bar width={90} />
        <Bar width={240} height={28} />
        <div className="grid-cards">
          <article className="card" style={{ display: "grid", gap: 12 }}>
            <Bar width="40%" />
            <Bar width="55%" height={32} />
            <Bar width="80%" />
          </article>
          <article className="card" style={{ display: "grid", gap: 12 }}>
            <Bar width="50%" />
            <Bar width="70%" />
            <Bar width="64%" />
            <Bar width="88%" />
          </article>
        </div>
        <div className="activity-columns">
          {["Pagos", "Pedidos", "Cotizaciones"].map((title) => (
            <article className="card" key={title} style={{ display: "grid", gap: 12 }}>
              <Bar width={100} />
              <Bar />
              <Bar />
              <Bar width="80%" />
            </article>
          ))}
        </div>
      </div>
    </Status>
  );
}

export function FormSkeleton({ fields }: { fields: number }) {
  return (
    <Status>
      <div style={{ display: "grid", gap: 16 }}>
        <Bar width={100} />
        <Bar width={220} height={28} />
        <div className="card" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          {Array.from({ length: fields }, (_, index) => (
            <span key={index} style={{ display: "grid", gap: 8 }}>
              <Bar width="45%" />
              <Bar height={40} />
            </span>
          ))}
        </div>
      </div>
    </Status>
  );
}
