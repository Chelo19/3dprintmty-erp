import { useState, type ReactNode } from "react";

const SIZES = [10, 25, 50, 100];

export function Pagination({ size, from, to, total, hasPrevious, hasNext, busy = false, onSizeChange, onPrevious, onNext, label = "Paginación" }: {
  size: number;
  from: number;
  to: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
  busy?: boolean;
  onSizeChange: (size: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  label?: string;
}) {
  return <nav className="pager" aria-label={label}>
    <label>
      Cantidad
      <select value={size} onChange={(event) => onSizeChange(Number(event.target.value))}>
        {SIZES.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
    <span>{from}–{to} de {total}</span>
    <button className="ghost" type="button" disabled={!hasPrevious || busy} onClick={onPrevious}>Anterior</button>
    <button className="ghost" type="button" disabled={!hasNext || busy} onClick={onNext}>Siguiente</button>
  </nav>;
}

export function Paged<T>({ rows, children }: { rows: T[]; children: (rows: T[]) => ReactNode }) {
  const [size, setSize] = useState(10);
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages);
  const start = (current - 1) * size;
  const slice = rows.slice(start, start + size);
  const from = rows.length === 0 ? 0 : start + 1;
  const to = start + slice.length;
  return <div>
    {children(slice)}
    <Pagination size={size} from={from} to={to} total={rows.length} hasPrevious={current > 1} hasNext={current < pages}
      onSizeChange={(next) => { setSize(next); setPage(1); }} onPrevious={() => setPage(current - 1)} onNext={() => setPage(current + 1)} />
  </div>;
}
