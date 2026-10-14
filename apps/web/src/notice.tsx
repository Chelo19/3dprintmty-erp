import type { ReactNode } from "react";

export function Notice({ title, children, action, tone = "info" }: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  tone?: "info" | "error";
}) {
  return <div className={`notice-banner notice-banner-${tone}`} role={tone === "error" ? "alert" : "status"} aria-atomic="true">
    <span className="notice-banner-icon" aria-hidden="true">{tone === "error" ? "!" : "i"}</span>
    <div className="notice-banner-body"><strong>{title}</strong><div>{children}</div>{action ? <div className="notice-banner-action">{action}</div> : null}</div>
  </div>;
}
