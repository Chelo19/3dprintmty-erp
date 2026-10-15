export interface RecordActionState {
  action: string;
  pending: boolean;
  error: string | null;
}

/** El bloqueo pertenece al registro: otra fila puede avanzar independientemente. */
export function createRecordActions() {
  let snapshot: Readonly<Record<string, RecordActionState>> = {};
  const listeners = new Set<() => void>();
  const update = (id: string, state: RecordActionState | null) => {
    const next = { ...snapshot };
    if (state) next[id] = state;
    else delete next[id];
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async run(id: string, action: string, task: () => Promise<void>): Promise<boolean> {
      // Síncrono: protege también contra doble clic antes del siguiente render.
      if (snapshot[id]?.pending) return false;
      update(id, { action, pending: true, error: null });
      try {
        await task();
        update(id, null);
        return true;
      } catch (error) {
        update(id, { action, pending: false, error: error instanceof Error ? error.message : "No se pudo completar la acción." });
        return false;
      }
    },
  };
}
