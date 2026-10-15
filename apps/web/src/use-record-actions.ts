import { useState, useSyncExternalStore } from "react";
import { createRecordActions } from "./record-actions";

export function useRecordActions() {
  const [actions] = useState(createRecordActions);
  const records = useSyncExternalStore(actions.subscribe, actions.getSnapshot, actions.getSnapshot);
  return {
    records,
    pendingCount: Object.values(records).filter((record) => record.pending).length,
    run: actions.run,
  };
}
