import type { ReactNode } from "react";
import { Link, type To } from "react-router-dom";

function BackLabel({ children }: { children?: ReactNode }) {
  return <><span className="back-control-arrow" aria-hidden="true">←</span><span>Regresar{children ? <> a {children}</> : null}</span></>;
}

export function BackLink({ to, children }: { to: To; children?: ReactNode }) {
  return <Link to={to} className="back-control"><BackLabel>{children}</BackLabel></Link>;
}

export function BackButton({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="back-control" onClick={onClick} disabled={disabled}><BackLabel /></button>;
}
