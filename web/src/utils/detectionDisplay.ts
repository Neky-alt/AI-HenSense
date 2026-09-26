import type { Detection } from "../types/detection";

export function detectionTriggerLabel(trigger: Detection["trigger_type"]): string {
  switch (trigger) {
    case "manual": return "Manual Detection";
    case "free_range_snapshot": return "Formal Result Snapshot";
    case "scheduled": return "Scheduled Detection";
    default: return "Detection";
  }
}
