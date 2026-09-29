import { AppError, err, ok, type Result } from "@3dprintmty/shared";

export const SERVICE_RESOLUTIONS = [
  "pending",
  "in_progress",
  "delivered",
  "accepted",
  "rework",
  "waived",
] as const;

export type ServiceResolution = (typeof SERVICE_RESOLUTIONS)[number];

const SERVICE_RESOLUTION_TRANSITIONS: Record<ServiceResolution, readonly ServiceResolution[]> = {
  pending: ["in_progress", "waived"],
  in_progress: ["delivered", "rework", "waived"],
  rework: ["in_progress", "waived"],
  delivered: ["accepted", "rework"],
  accepted: [],
  waived: [],
};

/** El servicio ya se prestó, el cliente lo aceptó o se condonó. */
export function serviceIsSettled(resolution: string): boolean {
  return resolution === "delivered" || resolution === "accepted" || resolution === "waived";
}

export function transitionServiceResolution(
  from: ServiceResolution,
  to: ServiceResolution,
): Result<ServiceResolution> {
  if (!SERVICE_RESOLUTION_TRANSITIONS[from].includes(to)) {
    return err(
      new AppError(
        "invalid_transition",
        `La resolución del servicio no puede pasar de ${from} a ${to}.`,
      ),
    );
  }
  return ok(to);
}
