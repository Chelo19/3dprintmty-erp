import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Notice } from "./notice";
import { useCanWrite } from "./roles";

export function EmptyState({ title, children, to, actionLabel }: {
  title: string;
  children: ReactNode;
  to: string;
  actionLabel: string;
}) {
  const canCreate = useCanWrite(to);
  return <Notice title={title} action={canCreate ? <Link className="primary new-link" to={to}>{actionLabel}</Link> : undefined}>
    {children}
  </Notice>;
}
