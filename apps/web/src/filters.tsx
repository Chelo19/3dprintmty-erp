import { useId, useState, type ReactNode } from "react";
import { Notice } from "./notice";
import { useSearchParams } from "react-router-dom";

export type StatusFilter = "active" | "inactive" | "all";

export function useFilters<T extends Record<string, string>>(defaults: T) {
  const [params, setParams] = useSearchParams();
  const values = Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [key, params.get(key) ?? fallback]),
  ) as T;
  const dirty = Object.entries(defaults).some(([key, fallback]) => values[key] !== fallback);
  return {
    values,
    dirty,
    set(key: keyof T & string, value: string) {
      setParams((current) => {
        const next = new URLSearchParams(current);
        if (value === defaults[key]) next.delete(key);
        else next.set(key, value);
        return next;
      }, { replace: true });
    },
    reset() {
      setParams((current) => {
        const next = new URLSearchParams(current);
        for (const key of Object.keys(defaults)) next.delete(key);
        return next;
      }, { replace: true });
    },
  };
}

export function matchesStatus(status: string | null | undefined, filter: string) {
  const inactive = status === "inactive";
  if (filter === "all") return true;
  return filter === "inactive" ? inactive : !inactive;
}

export function matchesText(query: string, ...fields: Array<string | null | undefined>) {
  const needle = normalize(query);
  if (!needle) return true;
  return fields.some((field) => normalize(field ?? "").includes(needle));
}

export function distinct(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "es"));
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function FilterBar({
  search,
  onSearch,
  placeholder,
  status,
  onStatus,
  hiddenInactive = 0,
  dirty,
  onClear,
  children,
}: {
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  status?: string;
  onStatus?: (value: StatusFilter) => void;
  hiddenInactive?: number;
  dirty: boolean;
  onClear: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="filters">
      <label className="filters-search">
        Buscar
        <input type="search" value={search} placeholder={placeholder} onChange={(event) => onSearch(event.target.value)} />
      </label>
      {onStatus ? (
        <label>
          Estado
          <select value={status} onChange={(event) => onStatus(event.target.value as StatusFilter)}>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
            <option value="all">Todos</option>
          </select>
        </label>
      ) : null}
      {children}
      {dirty ? <button className="ghost" type="button" onClick={onClear}>Quitar filtros</button> : null}
      {hiddenInactive > 0 && onStatus ? (
        <p className="costing-hint filters-note">
          {hiddenInactive === 1 ? "Hay 1 registro inactivo oculto." : `Hay ${hiddenInactive} registros inactivos ocultos.`}{" "}
          <button className="link-button" type="button" onClick={() => onStatus("all")}>Mostrar todos</button>
        </p>
      ) : null}
    </div>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel = "Todos",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  allLabel?: string;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function FilterAutocomplete({
  label,
  value,
  onChange,
  options,
  placeholder,
  required = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const suggestions = options.filter((option) => matchesText(value, option)).slice(0, 20);
  const activeIndex = active < suggestions.length ? active : -1;
  const isOpen = open && !disabled;
  function select(option: string) {
    onChange(option);
    setOpen(false);
    setActive(-1);
  }
  return (
    <div className="filter-autocomplete">
      <label htmlFor={`${listId}-input`}>{label}</label>
      <input
        id={`${listId}-input`}
        type="text"
        required={required}
        disabled={disabled}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        aria-activedescendant={isOpen && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        value={value}
        onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); setActive(-1); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { setOpen(false); setActive(-1); }
          if ((event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.length) {
            event.preventDefault();
            setOpen(true);
            setActive(event.key === "ArrowDown"
              ? (activeIndex + 1) % suggestions.length
              : (activeIndex <= 0 ? suggestions.length - 1 : activeIndex - 1));
          }
          if (event.key === "Enter" && open && activeIndex >= 0) {
            event.preventDefault();
            const selected = suggestions[activeIndex];
            if (selected !== undefined) select(selected);
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
      />
      {isOpen ? (
        <div id={listId} className="autocomplete-options" role="listbox" aria-label={`Sugerencias de ${label.toLowerCase()}`}>
          {suggestions.length ? suggestions.map((option, index) => (
            <button key={option} id={`${listId}-${index}`} className="autocomplete-option" type="button" role="option"
              aria-selected={index === activeIndex} tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()} onClick={() => select(option)}>
              {option}
            </button>
          )) : <div className="autocomplete-empty">Sin coincidencias</div>}
        </div>
      ) : null}
    </div>
  );
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const inactive = status === "inactive";
  return <span className={`res res-badge cat-${inactive ? "inactive" : "active"}`}>{inactive ? "Inactivo" : "Activo"}</span>;
}

export function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <Notice title="Sin resultados" action={<button className="ghost" type="button" onClick={onClear}>Quitar filtros</button>}>
      Ningún registro coincide con los filtros seleccionados.
    </Notice>
  );
}
