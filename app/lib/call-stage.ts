// Monday Call Stage label id 3 was renamed from "In Review" to "Pending".
// Older items, snapshots, and sheet rows can still carry "In Review", so both
// labels mean the same stage. This is not the same as "pending calls"
// (booked meetings that have not happened yet).
export const CALL_STAGE_PENDING = "Pending";
export const CALL_STAGE_PENDING_LEGACY = "In Review";
export const CALL_STAGE_PENDING_LABELS = [CALL_STAGE_PENDING, CALL_STAGE_PENDING_LEGACY];
export const CALL_STAGE_PENDING_DISPLAY = "Call Stage Pending (formerly In Review)";

export function isCallStagePending(stage: string) {
  return CALL_STAGE_PENDING_LABELS.includes(stage);
}

export function countCallStagePending(allByStage: Record<string, number>) {
  return CALL_STAGE_PENDING_LABELS.reduce((sum, label) => sum + (allByStage[label] || 0), 0);
}

export function mentionsCallStagePending(normalizedQuestion: string) {
  return /\b(in review|review|pending)\b/.test(normalizedQuestion);
}
