import type { LarkReportBlock } from "./lark.ts";
import {
  type ExecutiveSalesPulseDeal,
  type buildExecutiveSalesPulseReport,
} from "./executive-sales-pulse-preview.ts";

type ExecutiveReport = ReturnType<typeof buildExecutiveSalesPulseReport>;

export function buildExecutiveSalesPulseLarkBlocks(
  report: ExecutiveReport,
): LarkReportBlock[] {
  const blocks: LarkReportBlock[] = [
    {
      type: "text",
      text: "Board 5029402147 - Monday and linked meeting-note review",
    },
    {
      type: "text",
      text: `Reporting window: ${formatSgt(report.window.start)} through ${formatSgt(report.window.end)}`,
    },
    { type: "text", text: `Generated: ${formatSgt(report.generatedAt)}` },
    { type: "divider" },
    { type: "heading1", text: "Executive Summary" },
    {
      type: "text",
      text: movementSummary(report),
    },
    {
      type: "text",
      text: healthSummary(report),
    },
    {
      type: "text",
      text: prioritySummary(report),
    },
    { type: "divider" },
    { type: "heading1", text: "Pipeline Health" },
    {
      type: "text",
      text: `${pipelineStatusEmoji(report.pipelineHealthPresentation.status)} Overall Health: ${report.pipelineHealthPresentation.status}`,
      bold: true,
    },
    ...report.pipelineHealthPresentation.basis.map((text) => ({
      type: "text" as const,
      text: `• ${text}`,
    })),
    {
      type: "heading2",
      text: "Latest Forward Outcome per Account in This Reporting Window",
    },
    {
      type: "table",
      rows: [
        [
          "Agreement Stage",
          "Confirmed (Verbal)",
          "2nd call with Nuseir",
          "Signed",
          "Lost / Gone Cold",
        ],
        [
          companyCell(report.pipelineHealthPresentation.latestOutcomeCompanies["Agreement Stage"]),
          companyCell(report.pipelineHealthPresentation.latestOutcomeCompanies["Confirmed (Verbal)"]),
          companyCell(report.pipelineHealthPresentation.latestOutcomeCompanies["2nd call with Nuseir"]),
          companyCell(report.pipelineHealthPresentation.latestOutcomeCompanies.Signed),
          companyCell(report.pipelineHealthPresentation.latestOutcomeCompanies["Lost / Gone Cold"]),
        ],
      ],
    },
    { type: "text", text: report.pipelineHealthPresentation.methodology },
    { type: "heading2", text: "Key Highlights" },
    ...asBullets(
      report.pipelineHealthPresentation.highlights,
      "No traceable forward-stage movement was recorded in this reporting window.",
    ),
    { type: "heading2", text: "Priority Closing Opportunities" },
    ...(report.priorityClosingDisplayDeals.length
      ? [
          {
            type: "table" as const,
            rows: [
              ["Company", "Budget", "Sales Agent", "Stage", "Plan for next action"],
              ...report.priorityClosingDisplayDeals.map((deal) => [
                deal.company,
                budget(deal),
                deal.owner || "Unassigned",
                deal.crmVerdict || "Unknown",
                "",
              ]),
            ],
          },
        ]
      : [
          {
            type: "text" as const,
            text: "No active Sales Qualified accounts are currently marked Proposal Done with a non-Signed verdict.",
          },
        ]),
    { type: "divider" },
    { type: "heading1", text: "Updates Since the Last Report" },
    ...promisingUpdateBlocks(report),
    { type: "divider" },
    { type: "heading1", text: "Leadership Attention" },
    ...asBullets(
      report.pipelineScorecard.whatNeedsAttention,
      "No evidence-based leadership issues were identified from the available fields.",
    ),
    { type: "divider" },
    { type: "heading1", text: "Calls and Conversion Snapshot" },
    {
      type: "table",
      rows: [
        ["Call outcome", "Count"],
        ...["New Meeting", "Completed", "Rescheduled", "No-show", "Cancelled"].map(
          (stage) => [stage, String(report.callStageSnapshot[stage as keyof typeof report.callStageSnapshot])],
        ),
      ],
    },
    { type: "divider" },
    { type: "heading1", text: "Monday Hygiene and Follow-up Exceptions" },
    ...asBullets(report.operationalAttention, "No Monday hygiene exceptions were identified."),
    { type: "divider" },
    { type: "heading1", text: "Upcoming Sales Meetings" },
    {
      type: "table",
      rows: [
        ["Company", "Meeting Time", "Country", "Sales Agent", "Budget", "Website"],
        ...report.upcomingMeetings.map((deal) => [
          deal.company,
          formatSgt(deal.nextMeetingAt || ""),
          deal.country || "Unknown",
          deal.owner || "Unknown",
          budget(deal),
          deal.website || "Unknown",
        ]),
      ],
    },
    { type: "divider" },
    {
      type: "text",
      text: `Source note: Monday board 5029402147, activity history for ${dateRange(report.window.start, report.window.end)} SGT, and preserved Monday questionnaire and salesperson notes. Missing or inaccessible meeting-document content is not inferred.`,
    },
  ];

  return blocks.flatMap((block) =>
    block.type === "table" ? splitLarkTable(block.rows, block.columnWidths) : [block],
  );
}

function movementSummary(report: ExecutiveReport) {
  return `The pipeline recorded the following movement during the reporting window: ${report.signedActivityDeals.length} moved to Signed, ${report.agreementStageActivityDeals.length} moved into Agreement Stage, ${report.confirmedVerbalWindowDeals.length} moved into Confirmed (Verbal), ${report.salesQualifiedWindowDeals.length} became Sales Qualified, and ${report.hotWindowDeals.length} became Hot.`;
}

function healthSummary(report: ExecutiveReport) {
  const score = report.pipelineScorecard;
  return `${score.activeOpportunities} active Sales Qualified accounts were assessed. ${score.stalled} meet the stalled definition, ${score.atRisk} have explicit risk signals, and required context is ${score.dataCompletenessPercentage ?? "Unknown"}% complete.`;
}

function prioritySummary(report: ExecutiveReport) {
  return report.priorityClosingDisplayDeals.length
    ? `The immediate priority is to progress ${report.priorityClosingDisplayDeals.length} Proposal Done opportunities that are not yet Signed and close the documented follow-ups.`
    : "No Proposal Done opportunities with a non-Signed verdict were identified; leadership should focus on traceable next-step movement and complete Monday updates.";
}

function promisingUpdateBlocks(report: ExecutiveReport): LarkReportBlock[] {
  const deals = report.salesQualifiedWindowDeals
    .filter(
      (deal) =>
        deal.customerIntent !== false &&
        deal.salespersonRecommendation !== false &&
        Boolean(deal.salesAgentNotes || deal.meetingNotes),
    )
    .slice(0, 4);
  if (!deals.length) {
    return [{
      type: "text",
      text: "No promising update with a traceable positive salesperson or meeting-note signal was available.",
    }];
  }
  return deals.map((deal) => ({
    type: "text",
    text: `• ${deal.company}: ${noteExcerpt(deal)}`,
  }));
}

function noteExcerpt(deal: ExecutiveSalesPulseDeal) {
  const note = (deal.salesAgentNotes || deal.meetingNotes || "")
    .replace(/\s+/g, " ")
    .trim();
  return note.length > 300 ? `${note.slice(0, 297)}...` : note;
}

function asBullets(values: string[], empty: string): LarkReportBlock[] {
  return values.length
    ? values.map((text) => ({ type: "text", text: `• ${text}` }))
    : [{ type: "text", text: empty }];
}

function companyCell(deals: ExecutiveSalesPulseDeal[]) {
  return deals.length ? deals.map((deal) => `• ${deal.company}`).join("\n") : "No accounts";
}

function budget(deal: ExecutiveSalesPulseDeal) {
  if (deal.annualMarketingBudgetLabel) return deal.annualMarketingBudgetLabel;
  if (deal.annualMarketingBudget === null) return "Unknown";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(deal.annualMarketingBudget);
}

function pipelineStatusEmoji(status: string) {
  if (status === "Healthy") return "🟢";
  if (status === "Needs Attention") return "🟡";
  if (status === "At Risk") return "🔴";
  return "⚪";
}

function splitLarkTable(rows: string[][], columnWidths?: number[]): LarkReportBlock[] {
  const [header, ...body] = rows;
  const blocks: LarkReportBlock[] = [];
  for (let index = 0; index < body.length; index += 8) {
    blocks.push({ type: "table", rows: [header, ...body.slice(index, index + 8)], columnWidths });
  }
  return blocks.length ? blocks : [{ type: "table", rows: [header], columnWidths }];
}

function formatSgt(value: string) {
  return `${new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))} SGT`;
}

export function dateRange(start: string, end: string) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${formatter.format(new Date(start))} - ${formatter.format(new Date(end))}`;
}
