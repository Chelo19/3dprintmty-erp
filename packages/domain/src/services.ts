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
  pending: ["in_progress"],
  in_progress: ["delivered", "rework"],
  rework: ["in_progress"],
  delivered: ["accepted", "rework"],
  accepted: [],
  waived: [],
};

/** La impresión o el servicio ya se prestó, o el cliente ya lo aceptó. */
export function serviceIsSettled(resolution: string): boolean {
  return resolution === "delivered" || resolution === "accepted";
}

/** La impresión o el producto terminado ya se marcó como prestado, o el cliente ya lo aceptó. */
export function isPrestado(resolution: string): boolean {
  return resolution === "delivered" || resolution === "accepted";
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
