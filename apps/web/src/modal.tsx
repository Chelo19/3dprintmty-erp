import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** El dialog nativo mantiene el foco y bloquea la interacción con el fondo. */
export function Modal({ title, children, onClose, closeDisabled = false }: { title: string; children: ReactNode; onClose: () => void; closeDisabled?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  return createPortal(
    <dialog ref={ref} className="app-modal" aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); if (!closeDisabled) onClose(); }}
      onClick={(event) => {
        if (closeDisabled || event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
      <header className="app-modal-header">
        <h2 id={titleId}>{title}</h2>
        <button className="ghost" type="button" autoFocus disabled={closeDisabled} onClick={onClose}>Cerrar</button>
      </header>
      <div className="app-modal-content">{children}</div>
    </dialog>, document.body,
  );
}
