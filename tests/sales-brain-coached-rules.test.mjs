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
