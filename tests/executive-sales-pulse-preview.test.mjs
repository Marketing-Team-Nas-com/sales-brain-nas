import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExecutiveSalesPulseReport,
  effectiveCallStage,
  healthForDeal,
  overallPipelineHealth,
  isHotOpportunity,
  isSalesQualified,
  isWorthSecondCall,
  reportingWindowFor,
  renderExecutiveSalesPulseHtml,
} from "../app/lib/executive-sales-pulse-preview.ts";
import {
  executiveSalesPulseFixture,
  fixtureGeneratedAt,
} from "../prototype/executive-sales-pulse-fixtures.ts";
import {
  buildExecutiveSalesPulseLarkBlocks,
  dateRange,
} from "../app/lib/executive-sales-pulse-lark.ts";

test("formats executive chat windows as dates only", () => {
  assert.equal(
    dateRange("2026-07-30T00:00:00+08:00", "2026-08-03T23:59:59+08:00"),
    "30 Jul 2026 - 3 Aug 2026",
  );
});

test("calculates Tuesday and Thursday reporting windows in SGT", () => {
  assert.deepEqual(reportingWindowFor("2026-08-04T14:00:00+08:00"), {
    cadence: "Tuesday",
    start: "2026-07-30T00:00:00+08:00",
    end: "2026-08-03T23:59:59+08:00",
  });
  assert.deepEqual(reportingWindowFor(fixtureGeneratedAt), {
    cadence: "Thursday",
    start: "2026-07-28T00:00:00+08:00",
    end: "2026-07-29T23:59:59+08:00",
  });
});

test("accepts an explicit read-only test window without changing cadence rules", () => {
  const window = {
    cadence: "Custom",
    start: "2026-07-24T00:00:00+08:00",
    end: "2026-07-29T23:59:59+08:00",
  };
  const report = buildExecutiveSalesPulseReport({
    fixture: executiveSalesPulseFixture,
    generatedAt: "2026-07-30T14:00:00+08:00",
    window,
  });

  assert.deepEqual(report.window, window);
});

test("assigns every included deal to exactly one funnel stage", () => {
  const report = fixtureReport();
  const stageCount = Object.values(report.funnel).reduce(
    (sum, count) => sum + count,
    0,
  );

  assert.equal(stageCount, report.deals.length);
  assert.equal(report.deals.length, 10);
  assert.ok(report.deals.every((deal) => report.funnel[deal.stage] >= 1));
});

test("reconciles funnel, active, and terminal totals", () => {
  const report = fixtureReport();
  const terminalTotal =
    report.funnel.Signed +
    report.funnel.Lost +
    report.funnel["Not Qualified"];

  assert.equal(report.funnelTotal, report.deals.length);
  assert.equal(report.activeDeals.length + terminalTotal, report.deals.length);
});

test("classifies Hot independently from health and excludes terminal stages", () => {
  const report = fixtureReport();
  const hotNames = report.hotOpportunities.map((deal) => deal.company);

  assert.deepEqual(hotNames, ["Aster Peak Systems", "Juniper Vale Foods"]);
  assert.equal(
    healthForDeal(
      report.hotOpportunities.find(
        (deal) => deal.company === "Aster Peak Systems",
      ),
    ),
    "At Risk",
  );
  assert.equal(
    executiveSalesPulseFixture.deals
      .filter(
        (deal) =>
          ["Signed", "Lost", "Not Qualified"].includes(deal.stage) ||
          deal.callStage === "No-show",
      )
      .some(isHotOpportunity),
    false,
  );
});

test("marks calls completed only from the three outcome call stages", () => {
  const report = fixtureReport();
  const questionnaireDeal = report.deals.find(
    (deal) => deal.company === "Aster Peak Systems",
  );
  const qualifiedDeal = report.deals.find(
    (deal) => deal.company === "Cobalt Harbor Mobility",
  );

  assert.equal(questionnaireDeal?.callStage, "Scheduled");
  assert.equal(
    questionnaireDeal ? effectiveCallStage(questionnaireDeal) : null,
    "Scheduled",
  );
  assert.equal(qualifiedDeal ? effectiveCallStage(qualifiedDeal) : null, "Completed");
  assert.equal("Not Scheduled" in report.callStageSnapshot, false);
  assert.equal(report.callStageSnapshot["No-show"], 1);
  assert.equal(report.callStageSnapshot["New Meeting"], 1);
  assert.equal(report.callStageSnapshot.Rescheduled, 1);
  assert.deepEqual(Object.keys(report.callStageSnapshot), [
    "New Meeting",
    "Completed",
    "Rescheduled",
    "No-show",
    "Cancelled",
  ]);
});

test("counts new leads by date added and reconciles qualification breakdown", () => {
  const report = fixtureReport();

  assert.equal(report.newLeads.length, 3);
  assert.deepEqual(report.newLeadBreakdown, {
    Fit: 1,
    "Not Fit": 1,
    Review: 1,
  });
  assert.equal(
    Object.values(report.newLeadBreakdown).reduce(
      (sum, count) => sum + count,
      0,
    ),
    report.newLeads.length,
  );
});

test("calculates an overall pipeline health rating from active deals", () => {
  const report = fixtureReport();
  const health = overallPipelineHealth(report.deals);

  assert.equal(health.rating, "Needs Attention");
  assert.equal(health.activeCount, report.activeDeals.length);
  assert.equal(health.atRiskCount, 4);
  assert.equal(health.healthyCount, 1);
});

test("does not let CRM verdict override contradictory intent or recommendation", () => {
  const report = fixtureReport();
  const deal = report.deals.find(
    (candidate) => candidate.company === "Aster Peak Systems",
  );

  assert.equal(deal?.crmVerdict, "Sales Qualified");
  assert.equal(deal?.customerIntent, false);
  assert.equal(deal?.salespersonRecommendation, false);
});

test("limits Sales Qualified views to qualified records", () => {
  const report = fixtureReport();

  assert.deepEqual(
    report.salesQualifiedDeals.map((deal) => deal.company),
    ["Aster Peak Systems", "Juniper Vale Foods", "Cobalt Harbor Mobility"],
  );
  assert.equal(report.salesQualifiedDeals.every(isSalesQualified), true);
  assert.deepEqual(report.activeSalesQualifiedDeals, report.salesQualifiedDeals);
});

test("separates agreement, signed, Hot, and worth-a-second-call signals", () => {
  const report = fixtureReport();

  assert.deepEqual(
    report.agreementStageDeals.map((deal) => deal.company),
    ["Juniper Vale Foods"],
  );
  assert.deepEqual(
    report.signedDeals.map((deal) => deal.company),
    ["Northwind Atelier"],
  );
  assert.deepEqual(
    report.worthSecondCallDeals.map((deal) => deal.company),
    ["Cobalt Harbor Mobility"],
  );
  assert.equal(report.worthSecondCallDeals.every(isWorthSecondCall), true);
  assert.equal(
    isWorthSecondCall(
      report.deals.find((deal) => deal.company === "Aster Peak Systems"),
    ),
    false,
  );
});

test("limits priority closing opportunities to active Proposal Done accounts not Signed", () => {
  const report = fixtureReport();

  assert.equal(
    report.priorityClosingDeals.every(
      (deal) =>
        /^Proposal Done$/i.test(deal.nextStepStatus || "") &&
        !/^Signed$/i.test(deal.crmVerdict || "") &&
        deal.stage !== "Signed",
    ),
    true,
  );
});

test("renders all-time strategic counts and in-window account activity", () => {
  const html = renderExecutiveSalesPulseHtml(fixtureReport());

  assert.match(html, /Strategic Accounts at a Glance/);
  assert.match(html, /Juniper Vale Foods/);
  assert.match(html, /All-Time Board Snapshot/);
  assert.doesNotMatch(html, /Northwind Atelier/);
  assert.match(html, /Activity in This Reporting Window/);
  assert.match(html, /Pipeline Health/);
  assert.match(html, /Priority Closing Opportunities/);
  assert.match(html, /Operational Attention/);
  assert.match(html, /Fit leads? (?:has|have) not booked a call/);
  assert.match(html, /<u>Guide<\/u>/);
  assert.doesNotMatch(html, /Source: Monday Final Verdict activity log/);
  assert.doesNotMatch(html, /Worth a Second Call\*/);
  assert.match(html, /Cobalt Harbor Mobility/);
  assert.doesNotMatch(html, /Updates Since We Last Met/);
  assert.doesNotMatch(html, /Calls and Post-Call Qualification/);
  assert.doesNotMatch(html, /Risks and Blockers/);
});

test("builds a Lark-native report from headings, text, dividers, and tables", () => {
  const blocks = buildExecutiveSalesPulseLarkBlocks(fixtureReport());

  assert.ok(blocks.some((block) => block.type === "heading1"));
  assert.ok(blocks.some((block) => block.type === "divider"));
  assert.ok(blocks.some((block) => block.type === "table"));
  assert.equal(
    blocks.some(
      (block) =>
        block.type === "text" &&
        /Strategic Accounts at a Glance/.test(block.text),
    ),
    false,
  );
  assert.match(JSON.stringify(blocks), /Executive Summary/);
  assert.doesNotMatch(JSON.stringify(blocks), /Northwind Atelier/);
  assert.match(JSON.stringify(blocks), /Pipeline Health/);
  assert.match(JSON.stringify(blocks), /Priority Closing Opportunities/);
  assert.match(JSON.stringify(blocks), /What Changed Since Tuesday/);
  assert.match(JSON.stringify(blocks), /Interesting Conversations/);
  assert.match(JSON.stringify(blocks), /Meaningful Forward Movement/);
  assert.match(JSON.stringify(blocks), /Issues and Follow-ups/);
  assert.match(JSON.stringify(blocks), /Leadership Attention/);
  assert.match(JSON.stringify(blocks), /Calls and Conversion Snapshot/);
  assert.match(JSON.stringify(blocks), /Monday Hygiene and Follow-up Exceptions/);
  assert.match(JSON.stringify(blocks), /Upcoming Sales Meetings/);
  assert.equal(
    blocks.some(
      (block) =>
        block.type === "text" &&
        /Overall Health:/.test(block.text) &&
        block.bold === true,
    ),
    true,
  );
  assert.doesNotMatch(JSON.stringify(blocks), /Status:/);
  assert.match(JSON.stringify(blocks), /• Juniper Vale Foods/);
  assert.doesNotMatch(JSON.stringify(blocks), /All-Time Board Snapshot/);
  assert.doesNotMatch(
    JSON.stringify(blocks),
    /Source: Monday Final Verdict activity log/,
  );
  assert.doesNotMatch(JSON.stringify(blocks), /Worth a Second Call\*/);
  assert.equal(
    blocks
      .filter((block) => block.type === "table")
      .every(
        (block) =>
          block.rows.length <= 9 &&
          block.rows.every((row) => row.length <= 6),
      ),
    true,
  );
});

test("renders the exact priority closing headers with blank manual action cells", () => {
  const fixture = structuredClone(executiveSalesPulseFixture);
  const candidate = fixture.deals.find((deal) => deal.id === "deal-cobalt");
  candidate.nextStepStatus = "Proposal Done";
  const report = buildExecutiveSalesPulseReport({
    fixture,
    generatedAt: fixtureGeneratedAt,
  });
  const blocks = buildExecutiveSalesPulseLarkBlocks(report);
  const priorityTable = blocks.find(
    (block) =>
      block.type === "table" &&
      block.rows[0]?.includes("Plan for next action"),
  );

  assert.deepEqual(priorityTable?.rows[0], [
    "Company",
    "Budget",
    "Sales Agent",
    "Stage",
    "Plan for next action",
  ]);
  assert.equal(priorityTable?.rows.slice(1).every((row) => row[4] === ""), true);
});

test("preserves missing context without inventing values", () => {
  const report = fixtureReport();
  const lumen = report.deals.find(
    (deal) => deal.company === "Lumen Orchard Health",
  );
  const cobalt = report.deals.find(
    (deal) => deal.company === "Cobalt Harbor Mobility",
  );

  assert.equal(lumen?.questionnaireUpdatedAt, null);
  assert.equal(lumen?.meetingDocumentUrl, null);
  assert.equal(cobalt?.meetingDocumentUrl, null);
  assert.equal(report.deals.some((deal) => deal.company === "Other Board Fictional Co."), false);
});

test("derives health independently from Hot priority", () => {
  const report = fixtureReport();
  const byName = new Map(report.deals.map((deal) => [deal.company, deal]));

  assert.equal(healthForDeal(byName.get("Aster Peak Systems")), "At Risk");
  assert.equal(healthForDeal(byName.get("Juniper Vale Foods")), "Healthy");
  assert.equal(healthForDeal(byName.get("Redwood Signal Group")), "At Risk");
  assert.equal(healthForDeal(byName.get("Northwind Atelier")), "Closed");
});

test("builds a traceable executive pipeline scorecard without budget-only health", () => {
  const report = fixtureReport();
  const scorecard = report.pipelineScorecard;

  assert.ok(["Healthy", "Needs Attention", "At Risk", "Insufficient data"].includes(scorecard.status));
  assert.equal(scorecard.whatImproved.length <= 3, true);
  assert.equal(scorecard.whatNeedsAttention.length <= 3, true);
  assert.equal(
    [...scorecard.whatImproved, ...scorecard.whatNeedsAttention].every((item) =>
      /Monday/.test(item),
    ),
    true,
  );
  assert.match(scorecard.explanation, /Budget alone does not affect this status/);
  assert.equal(typeof scorecard.qualifiedPipelineKnownValue, "number");
  assert.equal(report.pipelineHealthPresentation.status, scorecard.status);
  assert.deepEqual(
    Object.keys(report.pipelineHealthPresentation.latestOutcomeCompanies),
    [
      "Agreement Stage",
      "Confirmed (Verbal)",
      "2nd call with Nuseir",
      "Signed",
      "Lost / Gone Cold",
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(report.pipelineHealthPresentation),
    /Each account is counted once/,
  );
  assert.doesNotMatch(
    JSON.stringify(report.pipelineHealthPresentation.latestOutcomeCompanies),
    /Total forward outcomes/,
  );
  assert.match(
    report.pipelineHealthPresentation.methodology,
    /How health is determined/,
  );
  assert.doesNotMatch(
    report.pipelineHealthPresentation.basis.join(" "),
    /at least half of/,
  );
});

test("uses each account's latest in-window outcome for health movement evidence", () => {
  const fixture = structuredClone(executiveSalesPulseFixture);
  fixture.finalVerdictActivities.push({
    dealId: "deal-cobalt",
    occurredAt: "2026-07-29T18:00:00+08:00",
    verdict: "Lost",
  });
  const report = buildExecutiveSalesPulseReport({
    fixture,
    generatedAt: fixtureGeneratedAt,
  });

  assert.equal(
    report.latestForwardMovementDeals.some((deal) => deal.id === "deal-cobalt"),
    false,
  );
  assert.equal(
    report.latestNegativeMovementDeals.some((deal) => deal.id === "deal-cobalt"),
    true,
  );
});

function fixtureReport() {
  return buildExecutiveSalesPulseReport({
    fixture: executiveSalesPulseFixture,
    generatedAt: fixtureGeneratedAt,
  });
}
