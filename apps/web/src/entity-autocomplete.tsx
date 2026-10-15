import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { matchesText } from "./filters";

export interface EntityOption { id: string; label: string; searchText?: string }

/** Guarda la identidad elegida, nunca interpreta el texto libre como un registro. */
export function EntityAutocomplete({ label, name, value, onChange, options, placeholder, disabled = false }: {
  label: string; name?: string; value: string; onChange: (id: string) => void;
  options: EntityOption[]; placeholder: string; disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 240 });
  const selected = options.find((option) => option.id === value);
  const text = query ?? selected?.label ?? "";
  const matches = options.filter((option) => matchesText(query ?? "", option.label, option.searchText));
  const suggestions = matches.slice(0, 20);
  const activeIndex = active < suggestions.length ? active : -1;
  const isOpen = open && !disabled;

  useEffect(() => {
    input.current?.setCustomValidity(selected ? "" : "Selecciona una opción de las sugerencias.");
  }, [selected?.id, text]);
  useLayoutEffect(() => {
    if (!isOpen) return;
    function reposition() {
      const rect = input.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom;
      const above = below < 160 && rect.top > below;
      const height = Math.min(240, Math.max(80, (above ? rect.top : below) - 12));
      setPosition({ left: rect.left, top: above ? rect.top - height - 4 : rect.bottom + 4, width: rect.width, maxHeight: height });
    }
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => { window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && activeIndex >= 0) list.current?.children.item(activeIndex)?.scrollIntoView({ block: "nearest" });
  }, [isOpen, activeIndex]);

  function choose(option: EntityOption) {
    setQuery(null); setOpen(false); setActive(-1); onChange(option.id);
  }
  return <div className="entity-autocomplete">
    <label htmlFor={`${id}-input`}>{label}</label>
    <input ref={input} id={`${id}-input`} type="text" role="combobox" required disabled={disabled}
      autoComplete="off" aria-autocomplete="list" aria-expanded={isOpen}
      aria-controls={isOpen ? `${id}-options` : undefined}
      aria-activedescendant={isOpen && activeIndex >= 0 ? `${id}-${activeIndex}` : undefined}
      value={text} placeholder={placeholder}
      onFocus={() => setOpen(true)} onBlur={() => { setOpen(false); setActive(-1); }}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(-1); onChange(""); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); setOpen(false); setActive(-1); }
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.length) {
          event.preventDefault(); setOpen(true);
          setActive(event.key === "ArrowDown" ? (activeIndex + 1) % suggestions.length
            : activeIndex <= 0 ? suggestions.length - 1 : activeIndex - 1);
        }
        if (event.key === "Enter" && isOpen && activeIndex >= 0) {
          event.preventDefault(); const option = suggestions[activeIndex]; if (option) choose(option);
        } else if (event.key === "Enter" && isOpen && !selected) event.preventDefault();
      }} />
    {name ? <input type="hidden" name={name} value={selected?.id ?? ""} /> : null}
    {isOpen && position.width > 0 ? createPortal(
      <div ref={list} id={`${id}-options`} className="autocomplete-options entity-autocomplete-options" role="listbox" aria-label={`Sugerencias de ${label.toLowerCase()}`} style={position}>
        {suggestions.length ? suggestions.map((option, index) => <button id={`${id}-${index}`} key={option.id}
          className="autocomplete-option" type="button" role="option" tabIndex={-1} aria-selected={index === activeIndex}
          onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>{option.label}</button>)
          : <div className="autocomplete-empty">Sin coincidencias</div>}
        {matches.length > 20 ? <div className="autocomplete-empty">Escribe más para afinar la búsqueda.</div> : null}
      </div>, document.body) : null}
  </div>;
}
