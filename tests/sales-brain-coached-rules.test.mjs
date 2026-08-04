import assert from "node:assert/strict";
import test from "node:test";

import { answerSalesQuestion } from "../app/lib/sales-brain.ts";

function deal(overrides) {
  return {
    id: overrides.id,
    account: overrides.account,
    firstMeetingDate: "2026-07-31T10:00:00+08:00",
    latestMeetingDate: "",
    callStage: "Booked a Meeting",
    qualification: "Fit",
    budget: "$1M+ / year",
    nextStepsStatus: "",
    finalVerdict: "",
    ...overrides,
  };
}

test("counts completed calls only from the three coached call-stage outcomes", async () => {
  const activityChanges = [
    ["new", "", "Booked a Meeting"],
    ["sq", "Booked a Meeting", "Sales Qualified"],
    ["review", "Booked a Meeting", "In Review"],
    ["rescheduled", "Booked a Meeting", "Rescheduled"],
    ["no-show", "Booked a Meeting", "No Show"],
    ["cancelled", "Booked a Meeting", "Cancelled"],
  ].map(([itemId, previousValue, value]) => ({
    itemId,
    itemName: itemId,
    columnTitle: "Call Stage",
    previousValue,
    value,
    createdAt: "2026-08-01T08:00:00.000Z",
  }));
  const answer = await answerSalesQuestion({
    question: "How many calls were scheduled from July 30 to August 3?",
    deals: [],
    activityChanges,
  });

  assert.match(answer, /New Meeting: 1/);
  assert.match(answer, /Completed: 2/);
  assert.match(answer, /Rescheduled: 1/);
  assert.match(answer, /No-show: 1/);
  assert.match(answer, /Cancelled: 1/);
  assert.doesNotMatch(answer, /likely happened/i);
  assert.doesNotMatch(answer, /Fit leads|\$1M/i);
});

test("requires current Signed state and flags conflicting activity history", async () => {
  const deals = [
    deal({
      id: "confirmed",
      account: "Confirmed Co",
      callStage: "Sales Qualified",
      finalVerdict: "Signed",
    }),
    deal({
      id: "conflict",
      account: "Conflict Co",
      callStage: "Sales Qualified",
      finalVerdict: "Agreement Stage",
    }),
  ];
  const activityChanges = deals.map((item) => ({
    itemId: item.id,
    itemName: item.account,
    columnTitle: "Final Verdict",
    previousValue: "Agreement Stage",
    value: "Signed",
    createdAt: "2026-08-01T08:00:00.000Z",
  }));
  const answer = await answerSalesQuestion({
    question: "How many leads signed from July 30 to August 3?",
    deals,
    activityChanges,
  });

  assert.match(answer, /1 lead is confirmed as Signed/);
  assert.match(answer, /Confirmed Co/);
  assert.match(answer, /Conflict Co moved to Signed, but currently shows Agreement Stage/);
});

test("reconciles current fields, questionnaire, notes, activity, and conflicts for a lead", async () => {
  const contextDeal = deal({
    id: "context",
    account: "Context Co",
    callStage: "Sales Qualified",
    nextStepsStatus: "",
    finalVerdict: "Sales Qualified",
    salesPulseUpdates: [
      {
        classification: "structured_questionnaire",
        updateId: "questionnaire",
        authorId: "agent-1",
        authorName: "Sales Agent",
        timestamp: "2026-08-03T08:00:00.000Z",
        body: "Questionnaire",
        googleDocsUrl: "https://docs.google.com/document/d/fixture-doc/edit",
        googleDocsDocumentId: "fixture-doc",
        questionnaire: {
          decisionMaker: true,
          revenueAtLeast5m: true,
          marketingSpendAtLeast500k: true,
          interestedInNextStage: false,
          worthPursuing: false,
        },
        conflicts: [],
        verdict: "Sales Qualified",
        notes: "Customer asked for pricing.",
      },
      {
        classification: "salesperson_note",
        updateId: "note",
        authorId: "agent-1",
        authorName: "Sales Agent",
        timestamp: "2026-08-03T09:00:00.000Z",
        body: "Do not pursue until the buyer confirms interest.",
        googleDocsUrl: "",
        googleDocsDocumentId: "",
        questionnaire: {
          decisionMaker: null,
          revenueAtLeast5m: null,
          marketingSpendAtLeast500k: null,
          interestedInNextStage: null,
          worthPursuing: null,
        },
        conflicts: [],
        verdict: "",
        notes: "Do not pursue until the buyer confirms interest.",
      },
      {
        classification: "unrelated_or_system_comment",
        updateId: "system",
        authorId: "",
        authorName: "Automation",
        timestamp: "2026-08-03T10:00:00.000Z",
        body: "System synced.",
        googleDocsUrl: "",
        googleDocsDocumentId: "",
        questionnaire: {
          decisionMaker: null,
          revenueAtLeast5m: null,
          marketingSpendAtLeast500k: null,
          interestedInNextStage: null,
          worthPursuing: null,
        },
        conflicts: [],
        verdict: "",
        notes: "",
      },
    ],
  });
  const answer = await answerSalesQuestion({
    question: "What happened with Context Co?",
    deals: [contextDeal],
    activityChanges: [
      {
        itemId: "context",
        itemName: "Context Co",
        columnTitle: "Final Verdict",
        previousValue: "In Review",
        value: "Agreement Stage",
        createdAt: "2026-08-03T11:00:00.000Z",
      },
    ],
  });

  assert.match(answer, /Current CRM: Call Stage Sales Qualified/);
  assert.match(answer, /interested in next stage No/);
  assert.match(answer, /Latest salesperson note/);
  assert.match(answer, /Final Verdict: In Review → Agreement Stage/);
  assert.match(answer, /customer intent is No/);
  assert.match(answer, /salesperson recommendation is No/);
  assert.match(answer, /document content was not opened/);
  assert.match(answer, /1 unrelated or system comment was preserved but excluded/);
});
