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
  const answer = await answerSalesQuestion({
    question: "How many calls were scheduled from July 30 to August 3?",
    deals: [
      deal({ id: "booked", account: "Booked Only" }),
      deal({ id: "sq", account: "Qualified Call", callStage: "Sales Qualified" }),
      deal({ id: "no-show", account: "No Show", callStage: "No Show" }),
    ],
  });

  assert.match(answer, /3 calls were scheduled/);
  assert.match(answer, /1 were completed/);
  assert.match(
    answer,
    /Call Stage being Sales Qualified, Not Qualified, or In Review/,
  );
  assert.doesNotMatch(answer, /likely happened/i);
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
