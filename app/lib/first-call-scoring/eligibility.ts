import type { SalesDeal } from "../monday";

const EXCLUDED = /^(booked a meeting|cancelled|no show|rescheduled)$/i;
const COMPLETED = /^(sales qualified|not qualified|in review)$/i;

export function firstCallEligibility(deal: SalesDeal) {
  if (!deal.firstMeetingDate) return { eligible: false, reason: "missing-first-meeting-date" } as const;
  if (EXCLUDED.test(deal.callStage)) return { eligible: false, reason: "meeting-not-completed" } as const;
  if (!COMPLETED.test(deal.callStage)) return { eligible: false, reason: "completion-not-confirmed" } as const;
  if (deal.geminiNotesStatus === "Missing") return { eligible: true, action: "missing-notes" } as const;
  return { eligible: true, action: "read-notes" } as const;
}
