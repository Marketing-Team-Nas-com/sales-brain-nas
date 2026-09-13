import type {
  MondayBoardActivityChange,
  SalesDeal,
} from "./monday";
import type {
  ExecutiveSalesPulseDeal,
  ExecutiveSalesPulseFixture,
  FunnelStage,
  RecordedCallStage,
  ReportingWindow,
} from "./executive-sales-pulse-preview";

const MISSING_CALCULATED_VALUE = "5";

export function executiveSalesPulseFromMonday({
  deals,
  window,
  activityChanges = [],
}: {
  deals: SalesDeal[];
  window: ReportingWindow;
  activityChanges?: MondayBoardActivityChange[];
}): ExecutiveSalesPulseFixture {
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  const inWindow = (timestamp: string) => {
    const value = Date.parse(timestamp);
    return Number.isFinite(value) && value >= start && value <= end;
  };

  return {
    deals: deals
      .filter((deal) => deal.boardId === "5029402147")
      .map((deal) =>
        toExecutiveDeal(
          deal,
          activityChanges.filter((change) => change.itemId === deal.id),
        ),
      ),
    updates: deals.flatMap((deal) =>
      (deal.salesPulseUpdates || [])
        .filter(
          (update) =>
            inWindow(update.timestamp) &&
            update.classification !== "unrelated_or_system_comment",
        )
        .map((update) => ({
          id: update.updateId,
          boardId: deal.boardId || "",
          dealId: deal.id,
          occurredAt: update.timestamp,
          summary:
            update.classification === "structured_questionnaire"
              ? `${deal.account} — post-call questionnaire submitted${update.authorName ? ` by ${update.authorName}` : ""}.`
              : `${deal.account} — salesperson note added${update.authorName ? ` by ${update.authorName}` : ""}.`,
        })),
    ),
    callStageActivities: activityChanges
      .filter(
        (change) =>
          change.columnTitle.toLowerCase() === "call stage" &&
          inWindow(change.createdAt),
      )
      .map((change) => ({
        dealId: change.itemId,
        occurredAt: change.createdAt,
        stage: activityCallStage(change.previousValue, change.value),
      }))
      .filter(
        (
          activity,
        ): activity is {
          dealId: string;
          occurredAt: string;
          stage: "New Meeting" | "Scheduled" | "Rescheduled" | "Completed" | "No-show" | "Cancelled";
        } => activity.stage !== null,
      ),
    finalVerdictActivities: activityChanges
      .filter(
        (change) =>
          change.columnTitle.toLowerCase() === "final verdict" &&
          inWindow(change.createdAt) &&
          /^(Agreement Stage|Confirmed \(Verbal\)|2nd call with Nuseir|Signed|Lost|Gone Cold)$/i.test(
            change.value,
          ),
      )
      .map((change) => ({
        dealId: change.itemId,
        occurredAt: change.createdAt,
        verdict: normalizeFinalVerdictActivity(change.value),
      })),
  };
}

function normalizeFinalVerdictActivity(
  value: string,
):
  | "Agreement Stage"
  | "Confirmed (Verbal)"
  | "2nd call with Nuseir"
  | "Signed"
  | "Lost"
  | "Gone Cold" {
  if (/^agreement stage$/i.test(value)) return "Agreement Stage";
  if (/^confirmed \(verbal\)$/i.test(value)) return "Confirmed (Verbal)";
  if (/^2nd call with nuseir$/i.test(value)) return "2nd call with Nuseir";
  if (/^signed$/i.test(value)) return "Signed";
  if (/^lost$/i.test(value)) return "Lost";
  return "Gone Cold";
}

function toExecutiveDeal(
  deal: SalesDeal,
  activityChanges: MondayBoardActivityChange[],
): ExecutiveSalesPulseDeal {
  const structuredUpdates = (deal.salesPulseUpdates || [])
    .filter((update) => update.classification === "structured_questionnaire")
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  const questionnaire = structuredUpdates[0];
  const salespersonNote = (deal.salesPulseUpdates || [])
    .filter((update) => update.classification === "salesperson_note")
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];
  const finalVerdict = cleanCalculatedValue(deal.finalVerdict);
  const callStage = mapCallStage(cleanCalculatedValue(deal.callStage));
  const stage = mapFunnelStage(finalVerdict, callStage);
  const stageEnteredAt = latestChangeTimestamp(activityChanges, {
    columnTitle: "Final verdict",
    value: stage === "Agreement Stage" || stage === "Signed" ? stage : "",
  });
  const salesQualifiedAt = latestChangeTimestamp(activityChanges, {
    columnTitle: "Call Stage",
    value: "Sales Qualified",
  });
  const recentMovementAt =
    activityChanges
      .filter((change) => /^(Call Stage|Final verdict)$/i.test(change.columnTitle))
      .sort(
        (left, right) =>
          Date.parse(right.createdAt) - Date.parse(left.createdAt),
      )[0]?.createdAt || null;
  const forwardMovementAt =
    activityChanges
      .filter(
        (change) =>
          (/^Call Stage$/i.test(change.columnTitle) &&
            /^(Sales Qualified|In Review)$/i.test(change.value)) ||
          (/^Final verdict$/i.test(change.columnTitle) &&
            /^(2nd call|Confirmed \(Verbal\)|Agreement Stage|Signed)/i.test(
              change.value,
            )),
      )
      .sort(
        (left, right) =>
          Date.parse(right.createdAt) - Date.parse(left.createdAt),
      )[0]?.createdAt || null;
  const budget = parseBudgetLowerBound(deal.budget);
  const nextMeetingAt = futureMeeting(
    [deal.latestMeetingDate, deal.firstMeetingDate],
    "2026-07-30T00:00:00+08:00",
  );

  return {
    id: deal.id,
    boardId: deal.boardId || "",
    company: deal.account,
    contact: [deal.firstName, deal.lastName].filter(Boolean).join(" ") || null,
    website: deal.website || null,
    country: deal.country || null,
    dateAdded: sgtDate(deal.dateAdded || deal.createdAt),
    owner: deal.owner || "Unassigned",
    stage,
    callStage,
    annualMarketingBudget: budget,
    annualMarketingBudgetLabel:
      !deal.budget || /^unknown$/i.test(deal.budget) ? null : deal.budget,
    icpQualification: mapQualification(deal.qualification),
    customerIntent: questionnaire?.questionnaire.interestedInNextStage ?? null,
    salespersonRecommendation: questionnaire?.questionnaire.worthPursuing ?? null,
    crmVerdict: finalVerdict || null,
    nextStepStatus:
      cleanCalculatedValue(deal.nextStepsStatus || deal.nextStep) || null,
    everInAgreementStage: stage === "Agreement Stage" || stage === "Signed",
    agreementStageHistoryKnown:
      stage === "Agreement Stage" || stage === "Signed" ? true : false,
    salesAgentNotes: salespersonNote?.notes || deal.agentNotes || null,
    meetingNotes: questionnaire?.notes || deal.salesCallNotes || null,
    signedAt: null,
    stageEnteredAt,
    salesQualifiedAt,
    recentMovementAt,
    forwardMovementAt,
    questionnaireUpdatedAt: questionnaire?.timestamp || null,
    meetingDocumentUrl: questionnaire?.googleDocsUrl || null,
    blocker: null,
    leadershipDecision: null,
    firstMeetingAt: sgtDate(deal.firstMeetingDate) || null,
    latestMeetingAt: sgtDate(deal.latestMeetingDate) || null,
    latestSalespersonNoteAt: salespersonNote?.timestamp || null,
    nextMeetingAt,
  };
}

function activityCallStage(previousValue: string, value: string) {
  if (/^(Sales Qualified|Not Qualified|In Review)$/i.test(value)) {
    return "Completed" as const;
  }
  if (/^Booked a Meeting$/i.test(value)) {
    return previousValue ? ("Scheduled" as const) : ("New Meeting" as const);
  }
  if (/^Rescheduled$/i.test(value)) return "Rescheduled" as const;
  if (/^No[\s-]?Show$/i.test(value)) return "No-show" as const;
  if (/^Cancelled$/i.test(value)) return "Cancelled" as const;
  return null;
}

function latestChangeTimestamp(
  changes: MondayBoardActivityChange[],
  expected: { columnTitle: string; value: string },
) {
  if (!expected.value) return null;
  return (
    changes
      .filter(
        (change) =>
          change.columnTitle.toLowerCase() === expected.columnTitle.toLowerCase() &&
          change.value.toLowerCase() === expected.value.toLowerCase(),
      )
      .sort(
        (left, right) =>
          Date.parse(right.createdAt) - Date.parse(left.createdAt),
      )[0]?.createdAt || null
  );
}

function cleanCalculatedValue(value: string) {
  const cleaned = value.trim();
  return cleaned === MISSING_CALCULATED_VALUE ? "" : cleaned;
}

function mapFunnelStage(
  verdict: string,
  callStage: RecordedCallStage,
): FunnelStage {
  if (/^signed$/i.test(verdict)) return "Signed";
  if (/^lost$/i.test(verdict)) return "Lost";
  if (/agreement stage/i.test(verdict)) return "Agreement Stage";
  if (/confirmed \(verbal\)/i.test(verdict)) return "Proposal";
  if (/2nd call/i.test(verdict)) return "Sales Qualified";
  if (callStage === "Sales Qualified") return "Sales Qualified";
  if (callStage === "Not Qualified") return "Not Qualified";
  if (callStage === "In Review") return "In Review";
  if (["Scheduled", "Rescheduled", "No-show"].includes(callStage)) {
    return "Meeting Booked";
  }
  return "Unclassified";
}

function mapCallStage(value: string): RecordedCallStage {
  if (/^sales qualified$/i.test(value)) return "Sales Qualified";
  if (/^not qualified$/i.test(value)) return "Not Qualified";
  if (/^in review$/i.test(value)) return "In Review";
  if (/^rescheduled$/i.test(value)) return "Rescheduled";
  if (/^no[\s-]?show$/i.test(value)) return "No-show";
  if (/booked a meeting/i.test(value)) return "Scheduled";
  if (/cancelled|canceled/i.test(value)) return "Not Scheduled";
  return "Not Scheduled";
}

function mapQualification(value: string) {
  const cleaned = cleanCalculatedValue(value);
  if (/^fit$/i.test(cleaned)) return "Fit" as const;
  if (/^not fit$/i.test(cleaned)) return "Not Fit" as const;
  if (/^review$/i.test(cleaned)) return "Review" as const;
  return null;
}

function parseBudgetLowerBound(value: string) {
  const normalized = value.toLowerCase().replace(/\s+/g, "");
  if (!normalized || normalized === "unknown") return null;
  if (/\$1m\+/.test(normalized)) return 1_000_000;
  if (/\$500k-\$?1m/.test(normalized)) return 500_000;
  if (/\$300k-\$?1m/.test(normalized)) return 300_000;
  if (/\$100k-\$?1m/.test(normalized)) return 100_000;
  if (/\$100-500k/.test(normalized) || /\$100-300k/.test(normalized)) {
    return 100_000;
  }
  if (/\$10-100k/.test(normalized)) return 10_000;
  if (/lessthan\$100k/.test(normalized) || /lessthan\$10k/.test(normalized)) {
    return 0;
  }
  return null;
}

function sgtDate(value: string) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00+08:00`;
  return value;
}

function futureMeeting(values: string[], after: string) {
  return (
    values
      .map(sgtDate)
      .filter((value) => Date.parse(value) > Date.parse(after))
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0] || null
  );
}
