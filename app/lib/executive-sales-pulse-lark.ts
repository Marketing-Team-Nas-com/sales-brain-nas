import type { LarkReportBlock } from "./lark";
import {
  type ExecutiveSalesPulseDeal,
  type buildExecutiveSalesPulseReport,
} from "./executive-sales-pulse-preview.ts";

type ExecutiveReport = ReturnType<typeof buildExecutiveSalesPulseReport>;

export function buildExecutiveSalesPulseLarkBlocks(
  report: ExecutiveReport,
): LarkReportBlock[] {
  const currency = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  const budget = (deal: ExecutiveSalesPulseDeal) =>
    deal.annualMarketingBudgetLabel ||
    (deal.annualMarketingBudget === null
      ? "Missing"
      : currency.format(deal.annualMarketingBudget));
  const blocks: LarkReportBlock[] = [
    {
      type: "text",
      text: `Board 5029402147`,
    },
    {
      type: "text",
      text: `Reporting window: ${formatSgt(report.window.start)} through ${formatSgt(report.window.end)}`,
    },
    {
      type: "text",
      text: `Generated: ${formatSgt(report.generatedAt)}`,
    },
    { type: "divider" },
    { type: "heading1", text: "1. Executive Summary" },
    {
      type: "table",
      rows: [
        ["Metric", "Count", "Meaning"],
        [
          "All Sales Qualified",
          String(report.salesQualifiedDeals.length),
          "Total number of accounts tagged Sales Qualified.",
        ],
        [
          "Newly Sales Qualified",
          String(report.salesQualifiedWindowDeals.length),
          "Leads verified by sales agents as Sales Qualified within the reporting window.",
        ],
        [
          "Hot Opportunities",
          String(report.hotWindowDeals.length),
          "Sales Qualified leads that became Hot within the reporting window.",
        ],
        [
          "Active Sales Qualified",
          String(report.activeSalesQualifiedDeals.length),
          "All-time Sales Qualified accounts that are not Signed, Lost, Not Qualified, or No-show.",
        ],
      ],
      columnWidths: [180, 70, 360],
    },
    { type: "divider" },
    { type: "heading1", text: "2. Pipeline Health" },
    { type: "heading2", text: "Overall Health" },
    {
      type: "text",
      text: `${pipelineStatusEmoji(report.pipelineHealthPresentation.status)} Overall Health: ${report.pipelineHealthPresentation.status}`,
      bold: true,
    },
    { type: "text", text: "Basis for this rating", bold: true },
    ...asBullets(
      report.pipelineHealthPresentation.basis,
      "Insufficient data: the health status cannot be supported.",
    ),
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
          companyCell(
            report.pipelineHealthPresentation.latestOutcomeCompanies[
              "Agreement Stage"
            ],
          ),
          companyCell(
            report.pipelineHealthPresentation.latestOutcomeCompanies[
              "Confirmed (Verbal)"
            ],
          ),
          companyCell(
            report.pipelineHealthPresentation.latestOutcomeCompanies[
              "2nd call with Nuseir"
            ],
          ),
          companyCell(
            report.pipelineHealthPresentation.latestOutcomeCompanies.Signed,
          ),
          companyCell(
            report.pipelineHealthPresentation.latestOutcomeCompanies[
              "Lost / Gone Cold"
            ],
          ),
        ],
      ],
    },
    {
      type: "text",
      text: report.pipelineHealthPresentation.methodology,
    },
    { type: "heading2", text: "Key Highlights" },
    ...asBullets(
      report.pipelineHealthPresentation.highlights,
      "Insufficient data: no traceable pipeline movement was recorded.",
    ),
    { type: "heading2", text: "Priority Closing Opportunities" },
    ...(report.priorityClosingDisplayDeals.length
      ? [{
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
        }]
      : [{
          type: "text" as const,
          text: "No priority closing opportunities could be supported by the available stage, next-step, budget, or note fields.",
        }]),
    { type: "heading2", text: "Operational Attention" },
    ...asBullets(report.operationalAttention, "Insufficient operational data."),
    {
      type: "heading2",
      text: "All-Time Board Snapshot — Strategic Accounts at a Glance",
    },
    {
      type: "table",
      rows: [
        [
          "Agreement Stage",
          "Confirmed (Verbal)",
          "Signed",
          "Lost & Gone Cold",
        ],
        [
          String(report.agreementStageDeals.length),
          String(report.confirmedVerbalDeals.length),
          String(report.signedDeals.length),
          String(report.lostGoneColdDeals.length),
        ],
      ],
    },
    { type: "heading2", text: "Activity in This Reporting Window" },
    {
      type: "table",
      rows: [
        [
          `Became Hot (${report.hotWindowDeals.length})`,
          `Agreement Stage (${report.agreementStageActivityDeals.length})`,
          `Confirmed (Verbal) (${report.confirmedVerbalWindowDeals.length})`,
          `2nd call with Nuseir (${report.secondCallWithNuseirWindowDeals.length})`,
          `Signed (${report.signedActivityDeals.length})`,
          `Lost & Gone Cold (${report.lostGoneColdWindowDeals.length})`,
        ],
        [
          companyCell(report.hotWindowDeals),
          companyCell(report.agreementStageActivityDeals),
          companyCell(report.confirmedVerbalWindowDeals),
          companyCell(report.secondCallWithNuseirWindowDeals),
          companyCell(report.signedActivityDeals),
          companyCell(report.lostGoneColdWindowDeals),
        ],
      ],
    },
    { type: "text", text: "Guide", bold: true, underline: true },
    {
      type: "text",
      text: "• Hot: An active Sales Qualified account with at least $1M in annual marketing spend or budget. Signed, Lost, Not Qualified, and no-show accounts are excluded.",
    },
    {
      type: "text",
      text: "• Worth a Second Call: Sales Qualified, at least $300K annual marketing budget/spend, never in Agreement Stage, and supported by a positive salesperson recommendation or explicit sales-agent/meeting-note signal.",
    },
    { type: "divider" },
    { type: "heading1", text: "3. New Leads and Call-Stage Snapshot" },
    {
      type: "table",
      rows: [
        ["New-lead qualification", "Count"],
        ...Object.entries(report.newLeadBreakdown).map(
          ([label, count]) => [label, String(count)],
        ),
      ],
      columnWidths: [260, 90],
    },
    { type: "heading2", text: "Call-Stage Snapshot" },
    {
      type: "table",
      rows: [
        ["Call stage", "Count"],
        ...Object.entries(report.callStageSnapshot).map(
          ([label, count]) => [label, String(count)],
        ),
      ],
      columnWidths: [260, 90],
    },
    { type: "divider" },
    { type: "heading1", text: "4. Leadership Decisions Required" },
    ...asBullets(
      report.leadershipDecisions.map(
        (deal) => `${deal.company} — ${deal.leadershipDecision}`,
      ),
      "No leadership decisions requested.",
    ),
    { type: "divider" },
    { type: "heading1", text: "5. Upcoming Meetings" },
    {
      type: "table",
      rows: [
        ["Company", "Website", "Meeting Time", "Country", "Sales Agent", "Budget"],
        ...report.upcomingMeetings.map((deal) => [
          deal.company,
          deal.website || "Unknown",
          formatSgt(deal.nextMeetingAt || ""),
          deal.country || "Unknown",
          deal.owner || "Unknown",
          budget(deal),
        ]),
      ],
    },
  ];

  return blocks.flatMap((block) =>
    block.type === "table"
      ? splitLarkTable(block.rows, block.columnWidths)
      : [block],
  );
}

function asBullets(values: string[], empty: string): LarkReportBlock[] {
  if (!values.length) return [{ type: "text", text: empty }];
  return values.map((text) => ({ type: "text", text: `• ${text}` }));
}

function companyCell(deals: ExecutiveSalesPulseDeal[]) {
  return deals.length
    ? deals.map((deal) => `• ${deal.company}`).join("\n")
    : "No accounts";
}

function pipelineStatusEmoji(status: string) {
  if (status === "Healthy") return "🟢";
  if (status === "Needs Attention") return "🟡";
  if (status === "At Risk") return "🔴";
  return "⚪";
}

function splitLarkTable(
  rows: string[][],
  columnWidths?: number[],
): LarkReportBlock[] {
  const [header, ...body] = rows;
  const blocks: LarkReportBlock[] = [];

  for (let index = 0; index < body.length; index += 8) {
    blocks.push({
      type: "table",
      rows: [header, ...body.slice(index, index + 8)],
      columnWidths,
    });
  }

  return blocks.length
    ? blocks
    : [{ type: "table", rows: [header], columnWidths }];
}

function formatSgt(value: string) {
  return (
    new Intl.DateTimeFormat("en-SG", {
      timeZone: "Asia/Singapore",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value)) + " SGT"
  );
}
