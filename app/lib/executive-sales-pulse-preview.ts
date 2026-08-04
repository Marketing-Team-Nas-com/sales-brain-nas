export const EXECUTIVE_SALES_BOARD_ID = "5029402147";

export type FunnelStage =
  | "New Lead"
  | "Meeting Booked"
  | "Sales Qualified"
  | "In Review"
  | "Proposal"
  | "Agreement Stage"
  | "Signed"
  | "Lost"
  | "Not Qualified"
  | "Unclassified";

export type CallStage =
  | "New Meeting"
  | "Scheduled"
  | "Rescheduled"
  | "Completed"
  | "No-show"
  | "Cancelled"
  | "Not Scheduled";

export type RecordedCallStage =
  | CallStage
  | "Sales Qualified"
  | "Not Qualified"
  | "In Review";

export type ExecutiveSalesPulseDeal = {
  id: string;
  boardId: string;
  company: string;
  contact: string | null;
  website?: string | null;
  country: string | null;
  dateAdded: string;
  owner: string;
  stage: FunnelStage;
  callStage: RecordedCallStage;
  annualMarketingBudget: number | null;
  annualMarketingBudgetLabel?: string | null;
  icpQualification: "Fit" | "Not Fit" | "Review" | null;
  customerIntent: boolean | null;
  salespersonRecommendation: boolean | null;
  crmVerdict: string | null;
  nextStepStatus?: string | null;
  everInAgreementStage: boolean;
  agreementStageHistoryKnown?: boolean;
  salesAgentNotes: string | null;
  meetingNotes: string | null;
  signedAt: string | null;
  stageEnteredAt?: string | null;
  salesQualifiedAt?: string | null;
  recentMovementAt?: string | null;
  forwardMovementAt?: string | null;
  questionnaireUpdatedAt: string | null;
  meetingDocumentUrl: string | null;
  blocker: string | null;
  leadershipDecision: string | null;
  firstMeetingAt?: string | null;
  latestMeetingAt?: string | null;
  latestSalespersonNoteAt?: string | null;
  nextMeetingAt: string | null;
};

export type ExecutiveSalesPulseUpdate = {
  id: string;
  boardId: string;
  dealId: string;
  occurredAt: string;
  summary: string;
};

export type ExecutiveSalesPulseFixture = {
  deals: ExecutiveSalesPulseDeal[];
  updates: ExecutiveSalesPulseUpdate[];
  callStageActivities?: Array<{
    dealId: string;
    occurredAt: string;
    stage: Exclude<CallStage, "Not Scheduled">;
  }>;
  finalVerdictActivities?: Array<{
    dealId: string;
    occurredAt: string;
    verdict:
      | "Agreement Stage"
      | "Confirmed (Verbal)"
      | "2nd call with Nuseir"
      | "Signed"
      | "Lost"
      | "Gone Cold";
  }>;
};

export type ReportingWindow = {
  cadence: "Tuesday" | "Thursday" | "Custom";
  start: string;
  end: string;
};

const STAGES: FunnelStage[] = [
  "New Lead",
  "Meeting Booked",
  "Sales Qualified",
  "In Review",
  "Proposal",
  "Agreement Stage",
  "Signed",
  "Lost",
  "Not Qualified",
  "Unclassified",
];

const DISPLAY_CALL_STAGES: CallStage[] = [
  "New Meeting",
  "Completed",
  "Rescheduled",
  "No-show",
  "Cancelled",
];

const TERMINAL_STAGES = new Set<FunnelStage>([
  "Signed",
  "Lost",
  "Not Qualified",
]);

export function reportingWindowFor(generatedAt: string): ReportingWindow {
  const parts = singaporeDateParts(generatedAt);
  const day = weekdayFromLocalDate(parts.date);

  if (day !== 2 && day !== 4) {
    throw new Error("Executive Sales Pulse previews must be generated on Tuesday or Thursday SGT.");
  }

  const startOffset = day === 2 ? -5 : -2;
  const endOffset = -1;
  return {
    cadence: day === 2 ? "Tuesday" : "Thursday",
    start: `${addLocalDays(parts.date, startOffset)}T00:00:00+08:00`,
    end: `${addLocalDays(parts.date, endOffset)}T23:59:59+08:00`,
  };
}

export function isHotOpportunity(deal: ExecutiveSalesPulseDeal) {
  return (
    isSalesQualified(deal) &&
    !TERMINAL_STAGES.has(deal.stage) &&
    !["New Lead", "Meeting Booked", "Unclassified"].includes(deal.stage) &&
    effectiveCallStage(deal) !== "No-show" &&
    deal.annualMarketingBudget !== null &&
    deal.annualMarketingBudget >= 1_000_000
  );
}

export function isSalesQualified(deal: ExecutiveSalesPulseDeal) {
  return (
    deal.stage === "Sales Qualified" ||
    deal.callStage === "Sales Qualified" ||
    deal.crmVerdict === "Sales Qualified"
  );
}

export function isWorthSecondCall(deal: ExecutiveSalesPulseDeal) {
  if (
    !isSalesQualified(deal) ||
    deal.annualMarketingBudget === null ||
    deal.annualMarketingBudget < 300_000 ||
    deal.stage === "Agreement Stage" ||
    deal.everInAgreementStage ||
    deal.agreementStageHistoryKnown === false ||
    deal.customerIntent === false ||
    deal.salespersonRecommendation === false
  ) {
    return false;
  }

  if (deal.salespersonRecommendation === true) return true;
  const notes = `${deal.salesAgentNotes || ""} ${deal.meetingNotes || ""}`;
  return /\b(?:worth pursuing|second call|follow[- ]?up call|solution workshop|next conversation)\b/i.test(
    notes,
  );
}

export function healthForDeal(
  deal: ExecutiveSalesPulseDeal,
): "Healthy" | "Watch" | "At Risk" | "Closed" {
  if (TERMINAL_STAGES.has(deal.stage)) return "Closed";
  if (
    deal.blocker ||
    effectiveCallStage(deal) === "No-show" ||
    deal.customerIntent === false ||
    deal.salespersonRecommendation === false
  ) {
    return "At Risk";
  }
  if (
    effectiveCallStage(deal) === "Rescheduled" ||
    deal.icpQualification === "Review" ||
    !deal.questionnaireUpdatedAt
  ) {
    return "Watch";
  }
  return "Healthy";
}

export function overallPipelineHealth(deals: ExecutiveSalesPulseDeal[]) {
  const active = deals.filter((deal) => !TERMINAL_STAGES.has(deal.stage));
  const atRisk = active.filter((deal) => healthForDeal(deal) === "At Risk");
  const healthy = active.filter((deal) => healthForDeal(deal) === "Healthy");
  const atRiskRate = active.length ? atRisk.length / active.length : 0;
  const rating =
    atRiskRate >= 0.4
      ? "Needs Attention"
      : atRiskRate < 0.25 && healthy.length >= atRisk.length
        ? "Strong"
        : "Mixed";

  return {
    rating,
    activeCount: active.length,
    atRiskCount: atRisk.length,
    healthyCount: healthy.length,
    atRiskRate,
  };
}

export function buildExecutiveSalesPulseReport({
  fixture,
  generatedAt,
  window: requestedWindow,
}: {
  fixture: ExecutiveSalesPulseFixture;
  generatedAt: string;
  window?: ReportingWindow;
}) {
  const window = requestedWindow || reportingWindowFor(generatedAt);
  const deals = fixture.deals.filter(
    (deal) => deal.boardId === EXECUTIVE_SALES_BOARD_ID,
  );
  const dealIds = new Set(deals.map((deal) => deal.id));
  const updates = fixture.updates.filter(
    (update) =>
      update.boardId === EXECUTIVE_SALES_BOARD_ID &&
      dealIds.has(update.dealId) &&
      Date.parse(update.occurredAt) >= Date.parse(window.start) &&
      Date.parse(update.occurredAt) <= Date.parse(window.end),
  );
  const funnel = Object.fromEntries(
    STAGES.map((stage) => [
      stage,
      deals.filter((deal) => deal.stage === stage).length,
    ]),
  ) as Record<FunnelStage, number>;
  const funnelTotal = Object.values(funnel).reduce((sum, count) => sum + count, 0);
  const newLeads = deals.filter(
    (deal) =>
      Date.parse(deal.dateAdded) >= Date.parse(window.start) &&
      Date.parse(deal.dateAdded) <= Date.parse(window.end),
  );
  const newLeadBreakdown = {
    Fit: newLeads.filter((deal) => deal.icpQualification === "Fit").length,
    "Not Fit": newLeads.filter((deal) => deal.icpQualification === "Not Fit").length,
    Review: newLeads.filter((deal) => deal.icpQualification === "Review").length,
  };
  const windowCallActivities = (fixture.callStageActivities || []).filter(
    (activity) =>
      dealIds.has(activity.dealId) &&
      Date.parse(activity.occurredAt) >= Date.parse(window.start) &&
      Date.parse(activity.occurredAt) <= Date.parse(window.end),
  );
  const callStageSnapshot = Object.fromEntries(
    DISPLAY_CALL_STAGES.map((stage) => [
      stage,
      windowCallActivities.filter((activity) => activity.stage === stage).length,
    ]),
  ) as Record<CallStage, number>;
  const hotOpportunities = deals.filter(isHotOpportunity);
  const activeDeals = deals.filter((deal) => !TERMINAL_STAGES.has(deal.stage));
  const salesQualifiedDeals = deals.filter(isSalesQualified);
  const activeSalesQualifiedDeals = salesQualifiedDeals.filter(
    (deal) =>
      !TERMINAL_STAGES.has(deal.stage) &&
      effectiveCallStage(deal) !== "No-show",
  );
  const pipelineHealthDeals = [...activeSalesQualifiedDeals].sort(
    (left, right) =>
      Number(isHotOpportunity(right)) - Number(isHotOpportunity(left)) ||
      healthRank(healthForDeal(right)) - healthRank(healthForDeal(left)) ||
      (right.annualMarketingBudget || 0) - (left.annualMarketingBudget || 0),
  );
  const pipelineHealthDisplayDeals = pipelineHealthDeals.slice(0, 25);
  const salesQualifiedCalls = salesQualifiedDeals.filter(
    (deal) =>
      deal.questionnaireUpdatedAt &&
      Date.parse(deal.questionnaireUpdatedAt) >= Date.parse(window.start) &&
      Date.parse(deal.questionnaireUpdatedAt) <= Date.parse(window.end),
  );
  const agreementStageDeals = deals.filter(
    (deal) => deal.stage === "Agreement Stage",
  );
  const confirmedVerbalDeals = deals.filter(
    (deal) => deal.crmVerdict === "Confirmed (Verbal)",
  );
  const signedDeals = deals.filter((deal) => deal.stage === "Signed");
  const lostGoneColdDeals = deals.filter((deal) =>
    /^(Lost|Gone Cold)$/i.test(deal.crmVerdict || ""),
  );
  const worthSecondCallDeals = deals.filter(isWorthSecondCall);
  const changedInWindow = (timestamp?: string | null) =>
    Boolean(
      timestamp &&
        Date.parse(timestamp) >= Date.parse(window.start) &&
        Date.parse(timestamp) <= Date.parse(window.end),
    );
  const agreementStageWindowDeals = agreementStageDeals.filter((deal) =>
    changedInWindow(deal.stageEnteredAt),
  );
  const signedWindowDeals = signedDeals.filter((deal) =>
    changedInWindow(deal.stageEnteredAt || deal.signedAt),
  );
  const hotWindowDeals = hotOpportunities.filter((deal) =>
    changedInWindow(deal.salesQualifiedAt || deal.stageEnteredAt),
  );
  const salesQualifiedWindowDeals = salesQualifiedDeals.filter((deal) =>
    changedInWindow(deal.salesQualifiedAt),
  );
  const worthSecondCallWindowDeals = worthSecondCallDeals.filter((deal) =>
    changedInWindow(deal.questionnaireUpdatedAt),
  );
  const finalVerdictActivities = (fixture.finalVerdictActivities || []).filter(
    (activity) =>
      dealIds.has(activity.dealId) &&
      Date.parse(activity.occurredAt) >= Date.parse(window.start) &&
      Date.parse(activity.occurredAt) <= Date.parse(window.end),
  );
  const dealsForVerdictActivity = (...verdicts: string[]) => {
    const activityDealIds = new Set(
      finalVerdictActivities
        .filter((activity) => verdicts.includes(activity.verdict))
        .map((activity) => activity.dealId),
    );
    return deals.filter((deal) => activityDealIds.has(deal.id));
  };
  const confirmedVerbalWindowDeals = dealsForVerdictActivity("Confirmed (Verbal)");
  const secondCallWithNuseirWindowDeals = dealsForVerdictActivity(
    "2nd call with Nuseir",
  );
  const agreementStageActivityDeals = dealsForVerdictActivity("Agreement Stage");
  const signedActivityDeals = dealsForVerdictActivity("Signed");
  const lostGoneColdWindowDeals = dealsForVerdictActivity("Lost", "Gone Cold");
  const positiveMovementDeals = uniqueDeals([
    ...salesQualifiedWindowDeals,
    ...agreementStageActivityDeals,
    ...confirmedVerbalWindowDeals,
    ...secondCallWithNuseirWindowDeals,
    ...signedActivityDeals,
  ]);
  const latestWindowOutcomeByDeal = new Map<
    string,
    {
      occurredAt: string;
      outcome: "Forward" | "Negative";
      stage:
        | "Sales Qualified"
        | "Agreement Stage"
        | "Confirmed (Verbal)"
        | "2nd call with Nuseir"
        | "Signed"
        | "Lost"
        | "Gone Cold";
    }
  >();
  for (const deal of salesQualifiedWindowDeals) {
    if (deal.salesQualifiedAt) {
      latestWindowOutcomeByDeal.set(deal.id, {
        occurredAt: deal.salesQualifiedAt,
        outcome: "Forward",
        stage: "Sales Qualified",
      });
    }
  }
  for (const activity of finalVerdictActivities) {
    const current = latestWindowOutcomeByDeal.get(activity.dealId);
    if (
      !current ||
      Date.parse(activity.occurredAt) >= Date.parse(current.occurredAt)
    ) {
      latestWindowOutcomeByDeal.set(activity.dealId, {
        occurredAt: activity.occurredAt,
        outcome: ["Lost", "Gone Cold"].includes(activity.verdict)
          ? "Negative"
          : "Forward",
        stage: activity.verdict,
      });
    }
  }
  const latestForwardMovementDeals = deals.filter(
    (deal) => latestWindowOutcomeByDeal.get(deal.id)?.outcome === "Forward",
  );
  const latestNegativeMovementDeals = deals.filter(
    (deal) => latestWindowOutcomeByDeal.get(deal.id)?.outcome === "Negative",
  );
  const latestForwardMovementBreakdown = [
    "Sales Qualified",
    "2nd call with Nuseir",
    "Confirmed (Verbal)",
    "Agreement Stage",
    "Signed",
  ].map((stage) => ({
    stage,
    deals: deals.filter(
      (deal) =>
        latestWindowOutcomeByDeal.get(deal.id)?.outcome === "Forward" &&
        latestWindowOutcomeByDeal.get(deal.id)?.stage === stage,
    ),
  }));
  const pipelineActivityHighlights = [
    movementHighlight("Signed", signedActivityDeals),
    movementHighlight("Agreement Stage", agreementStageActivityDeals),
    movementHighlight("Confirmed (Verbal)", confirmedVerbalWindowDeals),
    movementHighlight("2nd call with Nuseir", secondCallWithNuseirWindowDeals),
    salesQualifiedWindowDeals.length || hotWindowDeals.length
      ? `${salesQualifiedWindowDeals.length} leads became Sales Qualified and ${hotWindowDeals.length} became Hot in the reporting window${accountExamples(uniqueDeals([...salesQualifiedWindowDeals, ...hotWindowDeals]))}.`
      : "",
  ].filter(Boolean);
  const pipelineHealthSnapshot = {
    Healthy: pipelineHealthDeals.filter((deal) => healthForDeal(deal) === "Healthy").length,
    Watch: pipelineHealthDeals.filter((deal) => healthForDeal(deal) === "Watch").length,
    "At Risk": pipelineHealthDeals.filter((deal) => healthForDeal(deal) === "At Risk").length,
    Signed: signedDeals.length,
    Lost: deals.filter((deal) => deal.stage === "Lost").length,
    "Not Qualified": deals.filter((deal) => deal.stage === "Not Qualified").length,
  };
  const qualifiedPipelineKnownValue = activeSalesQualifiedDeals.reduce(
    (sum, deal) => sum + (deal.annualMarketingBudget || 0),
    0,
  );
  const qualifiedPipelineUnknownBudgets = activeSalesQualifiedDeals.filter(
    (deal) => deal.annualMarketingBudget === null,
  ).length;
  const movingForwardDeals = activeSalesQualifiedDeals.filter((deal) =>
    changedInWindow(deal.forwardMovementAt),
  );
  const stalledDeals = activeSalesQualifiedDeals.filter(
    (deal) => {
      if (/gone cold/i.test(deal.crmVerdict || "")) return true;
      const firstMeeting = deal.firstMeetingAt
        ? Date.parse(deal.firstMeetingAt)
        : Number.NaN;
      const latestMeeting = deal.latestMeetingAt
        ? Date.parse(deal.latestMeetingAt)
        : Number.NaN;
      const meetingHasNotAdvanced =
        Number.isFinite(firstMeeting) &&
        Number.isFinite(latestMeeting) &&
        latestMeeting <= firstMeeting;
      const noteBaseline = deal.questionnaireUpdatedAt || deal.firstMeetingAt;
      const hasLaterSalespersonNote = Boolean(
        noteBaseline &&
          deal.latestSalespersonNoteAt &&
          Date.parse(deal.latestSalespersonNoteAt) > Date.parse(noteBaseline),
      );
      return (
        !deal.nextStepStatus &&
        meetingHasNotAdvanced &&
        !hasLaterSalespersonNote
      );
    },
  );
  const stalledGoneColdDeals = stalledDeals.filter((deal) =>
    /gone cold/i.test(deal.crmVerdict || ""),
  );
  const stalledNoMovementOrNextStepDeals = stalledDeals.filter(
    (deal) =>
      !/gone cold/i.test(deal.crmVerdict || "") &&
      !deal.nextStepStatus &&
      Boolean(deal.firstMeetingAt) &&
      Boolean(deal.latestMeetingAt) &&
      Date.parse(deal.latestMeetingAt || "") <=
        Date.parse(deal.firstMeetingAt || "") &&
      !(
        (deal.questionnaireUpdatedAt || deal.firstMeetingAt) &&
        deal.latestSalespersonNoteAt &&
        Date.parse(deal.latestSalespersonNoteAt) >
          Date.parse(deal.questionnaireUpdatedAt || deal.firstMeetingAt || "")
      ),
  );
  const atRiskDeals = activeSalesQualifiedDeals.filter(
    (deal) => healthForDeal(deal) === "At Risk",
  );
  const completenessFields = activeSalesQualifiedDeals.flatMap((deal) => [
    deal.owner && deal.owner !== "Unassigned",
    deal.annualMarketingBudget !== null,
    Boolean(deal.country),
    Boolean(deal.website),
    deal.customerIntent !== null,
    deal.salespersonRecommendation !== null,
    Boolean(deal.nextStepStatus),
  ]);
  const dataCompletenessPercentage = completenessFields.length
    ? Math.round(
        (completenessFields.filter(Boolean).length / completenessFields.length) *
          100,
      )
    : null;
  const priorityClosingDeals = activeSalesQualifiedDeals
    .filter(
      (deal) =>
        /^proposal done$/i.test(deal.nextStepStatus || "") &&
        !/^signed$/i.test(deal.crmVerdict || ""),
    )
    .sort(
      (left, right) =>
        closingPriority(right) - closingPriority(left) ||
        (right.annualMarketingBudget || 0) -
          (left.annualMarketingBudget || 0),
    );
  const priorityClosingDisplayDeals = priorityClosingDeals.slice(0, 10);
  const completedOrNoShow =
    callStageSnapshot.Completed + callStageSnapshot["No-show"];
  const noShowRate =
    completedOrNoShow > 0
      ? (callStageSnapshot["No-show"] / completedOrNoShow) * 100
      : null;
  const fitWithoutBookedCall = activeDeals.filter(
    (deal) =>
      deal.icpQualification === "Fit" &&
      deal.callStage === "Not Scheduled",
  );
  const overdueBookedMeetings = activeDeals.filter(
    (deal) =>
      deal.callStage === "Scheduled" &&
      Boolean(deal.firstMeetingAt) &&
      Date.parse(deal.firstMeetingAt || "") < Date.parse(generatedAt),
  );
  const overdueBookedMeetingsWithoutOwner = overdueBookedMeetings.filter(
    (deal) => !deal.owner || deal.owner === "Unassigned",
  );
  const highBudgetAgencyOrB2bDeals = activeDeals.filter((deal) => {
    const context = `${deal.nextStepStatus || ""} ${deal.salesAgentNotes || ""} ${deal.meetingNotes || ""}`;
    return (
      deal.annualMarketingBudget !== null &&
      deal.annualMarketingBudget >= 1_000_000 &&
      (deal.icpQualification === "Fit" || deal.icpQualification === "Review") &&
      /\b(?:agency|b2b|client spend)\b/i.test(context)
    );
  });
  const operationalAttention = [
    noShowRate === null
      ? "No-show rate: Insufficient data because no completed or no-show call outcomes were recorded in the reporting window."
      : `No-show rate: ${noShowRate.toFixed(1)}% (${callStageSnapshot["No-show"]} no-shows out of ${completedOrNoShow} completed or no-show outcomes). Meeting confirmation and same-day reminders need attention.`,
    `${fitWithoutBookedCall.length} Fit ${fitWithoutBookedCall.length === 1 ? "lead has" : "leads have"} not booked a call${accountExamples(fitWithoutBookedCall)}. Review whether this reflects targeting quality or a gap in nudging qualified leads to schedule.`,
    overdueBookedMeetings.length
      ? `${overdueBookedMeetings.length} ${overdueBookedMeetings.length === 1 ? "account is" : "accounts are"} still marked Booked a Meeting even though the recorded first-meeting date has passed${accountExamples(overdueBookedMeetings)}. The assigned Sales Agent should update the call stage.`
      : "Booked-meeting follow-up: no accounts have a past first-meeting date while still marked Booked a Meeting.",
    overdueBookedMeetingsWithoutOwner.length
      ? `${overdueBookedMeetingsWithoutOwner.length} of those overdue booked meetings ${overdueBookedMeetingsWithoutOwner.length === 1 ? "has" : "have"} no assigned Sales Agent${accountExamples(overdueBookedMeetingsWithoutOwner)}. Assignment is flagged only because a booked Calendly meeting should identify its host.`
      : "Booked-meeting assignment: no overdue booked meetings are missing an assigned Sales Agent.",
    highBudgetAgencyOrB2bDeals.length
      ? `${highBudgetAgencyOrB2bDeals.length} high-budget agency or B2B ${highBudgetAgencyOrB2bDeals.length === 1 ? "lead is" : "leads are"} marked Fit or Review${accountExamples(highBudgetAgencyOrB2bDeals)}. Confirm whether the recorded budget is for internal use or client spend before investing further sales time.`
      : "High-budget agency/B2B qualification concern: no traceable matching records were found.",
  ];
  const pipelineStatus =
    !activeSalesQualifiedDeals.length || dataCompletenessPercentage === null
      ? "Insufficient data"
      : atRiskDeals.length / activeSalesQualifiedDeals.length >= 0.25 ||
          dataCompletenessPercentage < 50
        ? "At Risk"
        : stalledDeals.length > 0 ||
            atRiskDeals.length > 0 ||
            dataCompletenessPercentage < 80
          ? "Needs Attention"
          : "Healthy";
  const pipelineHealthBasis =
    pipelineStatus === "Insufficient data"
      ? [
          "Insufficient data: there are no active Sales Qualified accounts with enough context to assess pipeline health.",
        ]
      : [
          `${pipelineStatus}: ${stalledDeals.length} of ${activeSalesQualifiedDeals.length} active Sales Qualified accounts meet the stalled definition. ${stalledGoneColdDeals.length} ${stalledGoneColdDeals.length === 1 ? "is" : "are"} marked Gone Cold; ${stalledNoMovementOrNextStepDeals.length} remain Sales Qualified with an empty Next Steps value, no meeting recorded after the 1st Meeting Date, and no later salesperson follow-up note.`,
          `${atRiskDeals.length} active ${atRiskDeals.length === 1 ? "account has" : "accounts have"} an explicit risk signal, and required context is ${dataCompletenessPercentage}% complete.`,
        ];
  const pipelineHealthMethodology =
    "How health is determined: At Risk when at least 25% of active Sales Qualified accounts have explicit risk signals or required context is below 50% complete. Needs Attention when any active account is stalled or at risk, or completeness is below 80%. Otherwise, the pipeline is Healthy. The assessment uses movement, Next Steps, customer intent, salesperson recommendation, explicit risks, and data completeness; budget does not determine health.";
  const whatImproved = improvementEvidence({
    agreementStageWindowDeals,
    agreementStageActivityDeals,
    signedWindowDeals,
    signedActivityDeals,
    hotWindowDeals,
    movingForwardDeals,
  });
  const whatNeedsAttention = attentionEvidence({
    atRiskDeals,
    stalledDeals,
    dataCompletenessPercentage,
  });
  const upcomingMeetings = deals
    .filter(
      (deal) =>
        deal.nextMeetingAt &&
        Date.parse(deal.nextMeetingAt) > Date.parse(generatedAt),
    )
    .sort(
      (left, right) =>
        Date.parse(left.nextMeetingAt || "") - Date.parse(right.nextMeetingAt || ""),
    );

  return {
    generatedAt,
    window,
    deals,
    updates,
    funnel,
    funnelTotal,
    newLeads,
    newLeadBreakdown,
    callStageSnapshot,
    activeDeals,
    salesQualifiedDeals,
    activeSalesQualifiedDeals,
    agreementStageDeals,
    agreementStageWindowDeals,
    agreementStageActivityDeals,
    confirmedVerbalDeals,
    confirmedVerbalWindowDeals,
    secondCallWithNuseirWindowDeals,
    signedDeals,
    signedWindowDeals,
    signedActivityDeals,
    lostGoneColdDeals,
    lostGoneColdWindowDeals,
    pipelineHealthPresentation: {
      status: pipelineStatus,
      highlights: pipelineActivityHighlights,
      basis: pipelineHealthBasis,
      methodology: pipelineHealthMethodology,
      latestOutcomeCompanies: {
        "Agreement Stage":
          latestForwardMovementBreakdown.find(
            ({ stage }) => stage === "Agreement Stage",
          )?.deals || [],
        "Confirmed (Verbal)":
          latestForwardMovementBreakdown.find(
            ({ stage }) => stage === "Confirmed (Verbal)",
          )?.deals || [],
        "2nd call with Nuseir":
          latestForwardMovementBreakdown.find(
            ({ stage }) => stage === "2nd call with Nuseir",
          )?.deals || [],
        Signed:
          latestForwardMovementBreakdown.find(
            ({ stage }) => stage === "Signed",
          )?.deals || [],
        "Lost / Gone Cold": latestNegativeMovementDeals,
      },
    },
    latestForwardMovementDeals,
    latestForwardMovementBreakdown,
    latestNegativeMovementDeals,
    worthSecondCallDeals,
    worthSecondCallWindowDeals,
    hotWindowDeals,
    salesQualifiedWindowDeals,
    pipelineHealthSnapshot,
    pipelineScorecard: {
      status: pipelineStatus,
      activeOpportunities: activeSalesQualifiedDeals.length,
      qualifiedPipelineKnownValue,
      qualifiedPipelineUnknownBudgets,
      hotOpportunities: hotOpportunities.length,
      movingForward: movingForwardDeals.length,
      stalled: stalledDeals.length,
      atRisk: atRiskDeals.length,
      dataCompletenessPercentage,
      explanation: pipelineExplanation({
        status: pipelineStatus,
        activeCount: activeSalesQualifiedDeals.length,
        movingForwardCount: movingForwardDeals.length,
        stalledCount: stalledDeals.length,
        atRiskCount: atRiskDeals.length,
        completeness: dataCompletenessPercentage,
      }),
      whatImproved,
      whatNeedsAttention,
    },
    pipelineHealthDeals,
    pipelineHealthDisplayDeals,
    priorityClosingDeals,
    priorityClosingDisplayDeals,
    operationalAttention,
    salesQualifiedCalls,
    overallHealth: overallPipelineHealth(activeSalesQualifiedDeals),
    hotOpportunities,
    risks: deals.filter((deal) => healthForDeal(deal) === "At Risk"),
    leadershipDecisions: deals.filter((deal) => deal.leadershipDecision),
    upcomingMeetings,
  };
}

function movementHighlight(
  stage: string,
  deals: ExecutiveSalesPulseDeal[],
) {
  if (!deals.length) return `No accounts moved to ${stage} in this reporting window.`;
  return `${deals.length} ${deals.length === 1 ? "account moved" : "accounts moved"} to ${stage}: ${uniqueDeals(deals).map((deal) => deal.company).join(", ")}.`;
}

function closingPriority(deal: ExecutiveSalesPulseDeal) {
  if (deal.stage === "Agreement Stage") return 4;
  if (deal.crmVerdict === "Confirmed (Verbal)") return 3;
  const context = `${deal.nextStepStatus || ""} ${deal.salesAgentNotes || ""} ${deal.meetingNotes || ""}`;
  if (/\bproposal(?:\s+(?:completed|done|sent))?\b/i.test(context)) return 2;
  if (/\b(?:second call|2nd call)\b/i.test(context)) return 1;
  return 0;
}

export function priorityClosingNextStep(deal: ExecutiveSalesPulseDeal) {
  if (deal.nextStepStatus) return deal.nextStepStatus;
  const context = `${deal.nextStepStatus || ""} ${deal.salesAgentNotes || ""} ${deal.meetingNotes || ""}`;
  if (/\b(?:second call|2nd call)\b/i.test(context)) {
    return "Second call recorded in notes";
  }
  if (/\bproposal\s+(?:completed|done)\b/i.test(context)) {
    return "Proposal completed";
  }
  if (/\bproposal\b/i.test(context)) return "Proposal activity recorded";
  return "Unknown";
}

function improvementEvidence({
  agreementStageWindowDeals,
  signedWindowDeals,
  hotWindowDeals,
  movingForwardDeals,
}: {
  agreementStageWindowDeals: ExecutiveSalesPulseDeal[];
  signedWindowDeals: ExecutiveSalesPulseDeal[];
  hotWindowDeals: ExecutiveSalesPulseDeal[];
  movingForwardDeals: ExecutiveSalesPulseDeal[];
}) {
  const bullets = [
    evidenceBullet("Monday Final Verdict log", "entered Signed", signedWindowDeals),
    evidenceBullet(
      "Monday Final Verdict log",
      "entered Agreement Stage",
      agreementStageWindowDeals,
    ),
    evidenceBullet(
      "Monday Call Stage / Final Verdict log",
      "became Hot or moved forward",
      uniqueDeals([...hotWindowDeals, ...movingForwardDeals]),
    ),
  ].filter(Boolean) as string[];
  return bullets.slice(0, 3);
}

function attentionEvidence({
  atRiskDeals,
  stalledDeals,
  dataCompletenessPercentage,
}: {
  atRiskDeals: ExecutiveSalesPulseDeal[];
  stalledDeals: ExecutiveSalesPulseDeal[];
  dataCompletenessPercentage: number | null;
}) {
  const bullets: string[] = [];
  if (atRiskDeals.length) {
    bullets.push(
      `Monday questionnaire / Call Stage fields: ${atRiskDeals.length} active opportunities have an explicit negative intent, negative salesperson recommendation, blocker, or no-show${accountExamples(atRiskDeals)}.`,
    );
  }
  if (stalledDeals.length) {
    bullets.push(
      `Monday activity log and Next Steps: ${stalledDeals.length} active opportunities have no forward movement in the window and no recorded next step, or are marked Gone Cold${accountExamples(stalledDeals)}.`,
    );
  }
  if (dataCompletenessPercentage === null) {
    bullets.push("Monday current fields: data completeness is Unknown.");
  } else if (dataCompletenessPercentage < 100) {
    bullets.push(
      `Monday current fields: required pipeline context is ${dataCompletenessPercentage}% complete across owner, budget, country, website, intent, recommendation, and next step.`,
    );
  }
  return bullets.slice(0, 3);
}

function evidenceBullet(
  source: string,
  action: string,
  deals: ExecutiveSalesPulseDeal[],
) {
  if (!deals.length) return "";
  return `${source}: ${deals.length} ${deals.length === 1 ? "account" : "accounts"} ${action}${accountExamples(deals)}.`;
}

function accountExamples(deals: ExecutiveSalesPulseDeal[]) {
  const names = uniqueDeals(deals)
    .slice(0, 3)
    .map((deal) => deal.company);
  return names.length ? ` (${names.join(", ")}${deals.length > 3 ? ", …" : ""})` : "";
}

function uniqueDeals(deals: ExecutiveSalesPulseDeal[]) {
  return deals.filter(
    (deal, index, all) =>
      all.findIndex((candidate) => candidate.id === deal.id) === index,
  );
}

function pipelineExplanation({
  status,
  activeCount,
  movingForwardCount,
  stalledCount,
  atRiskCount,
  completeness,
}: {
  status: string;
  activeCount: number;
  movingForwardCount: number;
  stalledCount: number;
  atRiskCount: number;
  completeness: number | null;
}) {
  if (status === "Insufficient data") {
    return "Insufficient data: there are no active Sales Qualified opportunities or the required fields cannot be evaluated.";
  }
  return `${status} because ${movingForwardCount} of ${activeCount} active opportunities moved forward in the reporting window, ${stalledCount} are stalled, ${atRiskCount} have explicit risk signals, and required context is ${completeness}% complete. Budget alone does not affect this status.`;
}

function healthRank(health: ReturnType<typeof healthForDeal>) {
  return health === "At Risk" ? 3 : health === "Watch" ? 2 : health === "Healthy" ? 1 : 0;
}

export function renderExecutiveSalesPulseHtml(
  report: ReturnType<typeof buildExecutiveSalesPulseReport>,
) {
  const currency = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  const callStageRows = Object.entries(report.callStageSnapshot)
    .map(
      ([stage, count]) =>
        `<tr><td>${escapeHtml(stage)}</td><td>${count}</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Executive Sales Pulse — Fixture Preview</title>
  <style>
    :root { color-scheme: light; --ink:#1f2329; --muted:#646a73; --line:#dfe1e6; --paper:#f5f6f7; --green:#337e4d; --amber:#8f5b00; --red:#b4232c; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--paper); color:var(--ink); font:15px/1.6 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main { width:min(920px,calc(100% - 32px)); margin:24px auto 64px; background:white; border:1px solid var(--line); padding:48px 56px; }
    header { border-bottom:1px solid var(--line); padding-bottom:24px; margin-bottom:28px; }
    section { border-bottom:1px solid var(--line); padding:0 0 28px; margin-bottom:28px; }
    section:last-child { border-bottom:0; margin-bottom:0; }
    h1 { margin:0 0 8px; font-size:36px; line-height:1.15; }
    h2 { margin:0 0 14px; font-size:22px; }
    h3 { margin:22px 0 10px; font-size:17px; }
    .eyebrow { color:var(--green); font-size:12px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; }
    .meta,.muted { color:var(--muted); }
    table { width:100%; border-collapse:collapse; }
    th,td { border:1px solid var(--line); padding:9px 10px; text-align:left; vertical-align:top; }
    th { background:#f5f6f7; font-weight:700; }
    .summary-count { font-size:21px; font-weight:700; text-align:center; white-space:nowrap; }
    .tag { display:inline-block; border:1px solid currentColor; padding:2px 7px; font-size:12px; font-weight:700; }
    .hot { color:var(--amber); } .risk { color:var(--red); }
    .health-summary { border-left:4px solid var(--red); background:#fff8f7; padding:12px 14px; margin-bottom:16px; }
    .health-summary strong { font-size:20px; }
    .strategic-account { border-bottom:1px solid var(--line); padding:8px 0; }
    .strategic-account:last-child { border-bottom:0; }
    .strategic-account strong { display:block; }
    .strategic-account small { color:var(--muted); display:block; margin-top:3px; }
    .strategic-empty { color:var(--muted); padding:8px 0; }
    li { margin:7px 0; }
    @media (max-width:700px) { main { width:min(100% - 12px,920px); margin-top:6px; padding:24px 18px; } .wide { overflow-x:auto; } }
  </style>
</head>
<body>
<main>
  <header>
    <p class="eyebrow">Fixture-only prototype · Board ${EXECUTIVE_SALES_BOARD_ID}</p>
    <h1>Executive Sales Pulse</h1>
    <p class="meta"><strong>Reporting window:</strong> ${formatSgt(report.window.start)} through ${formatSgt(report.window.end)}</p>
    <p class="meta"><strong>Generated:</strong> ${formatSgt(report.generatedAt)}</p>
  </header>

  <section>
    <h2>1. Executive Summary</h2>
    <table><thead><tr><th>Metric</th><th>Count</th><th>Meaning</th></tr></thead><tbody>
      <tr><td><strong>All Sales Qualified</strong></td><td class="summary-count">${report.salesQualifiedDeals.length}</td><td>Total number of accounts tagged Sales Qualified.</td></tr>
      <tr><td><strong>Newly Sales Qualified</strong></td><td class="summary-count">${report.salesQualifiedWindowDeals.length}</td><td>Leads verified by sales agents as Sales Qualified within the reporting window.</td></tr>
      <tr><td><strong>Hot Opportunities</strong></td><td class="summary-count">${report.hotWindowDeals.length}</td><td>Sales Qualified leads that became Hot within the reporting window.</td></tr>
      <tr><td><strong>Active Sales Qualified</strong></td><td class="summary-count">${report.activeSalesQualifiedDeals.length}</td><td>All-time Sales Qualified accounts that are not Signed, Lost, Not Qualified, or No-show.</td></tr>
    </tbody></table>
    <p>This preview uses fictional fixture data only. Missing facts are shown as missing rather than inferred.</p>
  </section>

  <section>
    <h2>2. Pipeline Health</h2>
    <h3>Overall Health</h3>
    <div class="health-summary"><strong>${report.pipelineHealthPresentation.status === "Healthy" ? "🟢" : report.pipelineHealthPresentation.status === "Needs Attention" ? "🟡" : report.pipelineHealthPresentation.status === "At Risk" ? "🔴" : "⚪"} Overall Health: ${report.pipelineHealthPresentation.status}</strong></div>
    <p><strong>Basis for this rating</strong></p>
    <ul>${report.pipelineHealthPresentation.basis.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    <h3>Latest Forward Outcome per Account in This Reporting Window</h3>
    <div class="wide"><table><thead><tr><th>Agreement Stage</th><th>Confirmed (Verbal)</th><th>2nd call with Nuseir</th><th>Signed</th><th>Lost / Gone Cold</th></tr></thead><tbody><tr><td>${companyNames(report.pipelineHealthPresentation.latestOutcomeCompanies["Agreement Stage"])}</td><td>${companyNames(report.pipelineHealthPresentation.latestOutcomeCompanies["Confirmed (Verbal)"])}</td><td>${companyNames(report.pipelineHealthPresentation.latestOutcomeCompanies["2nd call with Nuseir"])}</td><td>${companyNames(report.pipelineHealthPresentation.latestOutcomeCompanies.Signed)}</td><td>${companyNames(report.pipelineHealthPresentation.latestOutcomeCompanies["Lost / Gone Cold"])}</td></tr></tbody></table></div>
    <p>${escapeHtml(report.pipelineHealthPresentation.methodology)}</p>
    <h3>Key Highlights</h3>
    ${report.pipelineHealthPresentation.highlights.length ? `<ul>${report.pipelineHealthPresentation.highlights.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<p>Insufficient data: no traceable pipeline movement was recorded.</p>"}
    <h3>Priority Closing Opportunities</h3>
    ${report.priorityClosingDisplayDeals.length ? `<div class="wide"><table><thead><tr><th>Company</th><th>Budget</th><th>Sales Agent</th><th>Stage</th><th>Plan for next action</th></tr></thead><tbody>${report.priorityClosingDisplayDeals.map((deal) => `<tr><td>${escapeHtml(deal.company)}</td><td>${escapeHtml(deal.annualMarketingBudgetLabel || (deal.annualMarketingBudget === null ? "Unknown" : currency.format(deal.annualMarketingBudget)))}</td><td>${escapeHtml(deal.owner || "Unassigned")}</td><td>${escapeHtml(deal.crmVerdict || "Unknown")}</td><td></td></tr>`).join("")}</tbody></table></div>` : "<p>No priority closing opportunities could be supported by the available stage, next-step, budget, or note fields.</p>"}
    <h3>Operational Attention</h3>
    <ul>${report.operationalAttention.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    <h3>All-Time Board Snapshot — Strategic Accounts at a Glance</h3>
    <div class="wide"><table><thead><tr>
      <th>Agreement Stage</th><th>Confirmed (Verbal)</th><th>Signed</th><th>Lost &amp; Gone Cold</th>
    </tr></thead><tbody><tr>
      <td>${report.agreementStageDeals.length}</td><td>${report.confirmedVerbalDeals.length}</td><td>${report.signedDeals.length}</td><td>${report.lostGoneColdDeals.length}</td>
    </tr></tbody></table></div>
    <h3>Activity in This Reporting Window</h3>
    <div class="wide"><table><thead><tr>
      <th>Became Hot (${report.hotWindowDeals.length})</th>
      <th>Agreement Stage (${report.agreementStageActivityDeals.length})</th>
      <th>Confirmed (Verbal) (${report.confirmedVerbalWindowDeals.length})</th>
      <th>Signed (${report.signedActivityDeals.length})</th>
      <th>Worth a Second Call (${report.worthSecondCallWindowDeals.length})</th>
      <th>Lost &amp; Gone Cold (${report.lostGoneColdWindowDeals.length})</th>
    </tr></thead><tbody><tr>
      <td>${companyNames(report.hotWindowDeals)}</td>
      <td>${companyNames(report.agreementStageActivityDeals)}</td>
      <td>${companyNames(report.confirmedVerbalWindowDeals)}</td>
      <td>${companyNames(report.signedActivityDeals)}</td>
      <td>${companyNames(report.worthSecondCallWindowDeals)}</td>
      <td>${companyNames(report.lostGoneColdWindowDeals)}</td>
    </tr></tbody></table></div>
    <p><strong><u>Guide</u></strong></p>
    <ul>
      <li><strong>Hot:</strong> An active Sales Qualified account with at least $1M in annual marketing spend or budget. Signed, Lost, Not Qualified, and no-show accounts are excluded.</li>
      <li><strong>Worth a Second Call:</strong> Sales Qualified, at least $300K annual marketing budget/spend, never in Agreement Stage, and supported by a positive salesperson recommendation or explicit sales-agent/meeting-note signal.</li>
    </ul>
  </section>

  <section>
    <h2>3. New Leads and Call-Stage Snapshot</h2>
    <p><strong>${report.newLeads.length} new lead${report.newLeads.length === 1 ? "" : "s"}</strong> entered board ${EXECUTIVE_SALES_BOARD_ID} during this reporting window.</p>
    <div class="wide"><table><thead><tr><th>New-lead qualification</th><th>Count</th></tr></thead><tbody>
      ${Object.entries(report.newLeadBreakdown).map(([qualification, count]) => `<tr><td>${escapeHtml(qualification)}</td><td>${count}</td></tr>`).join("")}
    </tbody></table></div>
    <h3>Call-stage snapshot</h3>
    <p>Call stage is reported separately from funnel stage. A call is <strong>Completed</strong> only when Call Stage is Sales Qualified, Not Qualified, or In Review.</p>
    <div class="wide"><table><thead><tr><th>Call stage</th><th>Count</th></tr></thead><tbody>${callStageRows}</tbody></table></div>
  </section>

  <section>
    <h2>4. Leadership Decisions Required</h2>
    ${report.leadershipDecisions.length ? `<ul>${report.leadershipDecisions.map((deal) => `<li><strong>${escapeHtml(deal.company)}</strong> — ${escapeHtml(deal.leadershipDecision || "")}</li>`).join("")}</ul>` : "<p>No leadership decisions requested.</p>"}
  </section>

  <section>
    <h2>5. Upcoming Meetings</h2>
    <div class="wide"><table><thead><tr><th>Company</th><th>Website</th><th>Meeting time</th><th>Country</th><th>Salesperson</th><th>Budget</th></tr></thead><tbody>
      ${report.upcomingMeetings.map((deal) => `<tr><td>${escapeHtml(deal.company)}</td><td>${escapeHtml(deal.website || "Unknown")}</td><td>${formatSgt(deal.nextMeetingAt || "")}</td><td>${escapeHtml(deal.country || "Unknown")}</td><td>${escapeHtml(deal.owner || "Unknown")}</td><td>${escapeHtml(deal.annualMarketingBudgetLabel || (deal.annualMarketingBudget === null ? "Unknown" : currency.format(deal.annualMarketingBudget)))}</td></tr>`).join("") || `<tr><td colspan="6">No upcoming meetings recorded.</td></tr>`}
    </tbody></table></div>
  </section>
</main>
</body>
</html>`;
}

function singaporeDateParts(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value || "";
  return { date: `${part("year")}-${part("month")}-${part("day")}` };
}

export function effectiveCallStage(deal: ExecutiveSalesPulseDeal): CallStage {
  if (
    ["Sales Qualified", "Not Qualified", "In Review"].includes(
      deal.callStage,
    )
  ) {
    return "Completed";
  }
  return deal.callStage;
}

function companyNames(deals: ExecutiveSalesPulseDeal[]) {
  if (!deals.length) {
    return `<div class="strategic-empty">No accounts</div>`;
  }
  return deals
    .map((deal) => `<div class="strategic-account">• ${escapeHtml(deal.company)}</div>`)
    .join("");
}

function weekdayFromLocalDate(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function addLocalDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function formatSgt(value: string) {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value)) + " SGT";
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] || character,
  );
}
