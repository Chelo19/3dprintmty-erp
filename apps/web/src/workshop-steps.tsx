import { useTranslation } from "react-i18next";

export function WorkshopSteps({ step, furthest = step, completed = false }: { step: number; furthest?: number; completed?: boolean }) {
  const { t } = useTranslation();
  const steps = ["account", "company", "branch", "tax", "payments", "demo"];
  return <nav className="onboarding-progress" aria-label={t("onboarding.progressLabel")}>
    <ol>
      {steps.map((key, index) => {
        const done = completed || index < furthest;
        const current = !completed && index === step;
        return <li key={key} className={current ? "is-current" : done ? "is-complete" : ""} aria-current={current ? "step" : undefined}>
          <span className="onboarding-marker" aria-hidden="true">{done && !current ? "✓" : index + 1}</span>
          <span className="onboarding-step-label">{t(`onboarding.${key}`)}<span className="onboarding-step-status">{t(current ? "onboarding.current" : done ? "onboarding.completed" : "onboarding.pending")}</span></span>
        </li>;
      })}
    </ol>
  </nav>;
}
