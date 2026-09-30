import { useState, type ReactNode } from "react";

const SIZES = [10, 25, 50, 100];

export function Paged<T>({ rows, children }: { rows: T[]; children: (rows: T[]) => ReactNode }) {
  const [size, setSize] = useState(10);
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages);
  const start = (current - 1) * size;
  const slice = rows.slice(start, start + size);
  const from = rows.length === 0 ? 0 : start + 1;
  const to = start + slice.length;
  return (
    <div>
      {children(slice)}
      <nav className="pager" aria-label="Paginación">
        <label>
          Cantidad
          <select
            value={size}
            onChange={(event) => {
              setSize(Number(event.target.value));
              setPage(1);
            }}
          >
            {SIZES.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <span>{from}–{to} de {rows.length}</span>
        <button className="ghost" type="button" disabled={current <= 1} onClick={() => setPage(current - 1)}>Anterior</button>
        <button className="ghost" type="button" disabled={current >= pages} onClick={() => setPage(current + 1)}>Siguiente</button>
      </nav>
    </div>
  );
}
