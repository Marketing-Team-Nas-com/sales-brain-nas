import assert from "node:assert/strict";
import test from "node:test";
import { firstCallEligibility } from "../app/lib/first-call-scoring/eligibility.ts";
import { overallScore } from "../app/lib/first-call-scoring/types.ts";
import { FIRST_CALL_SCORING_PROMPT } from "../app/lib/first-call-scoring/scorer.ts";

const deal = (callStage, geminiNotesStatus = "Linked") => ({ firstMeetingDate: "2026-08-27 10:00", callStage, geminiNotesStatus });

test("scores only confirmed completed first meetings", () => {
  for (const stage of ["Sales Qualified", "Not Qualified", "In Review"]) assert.equal(firstCallEligibility(deal(stage)).eligible, true);
  for (const stage of ["Booked a Meeting", "Cancelled", "No Show", "Rescheduled"]) assert.equal(firstCallEligibility(deal(stage)).eligible, false);
});
test("distinguishes missing notes from readable-note processing", () => {
  assert.equal(firstCallEligibility(deal("In Review", "Missing")).action, "missing-notes");
  assert.equal(firstCallEligibility(deal("In Review", "Linked")).action, "read-notes");
});

test("calculates overall as the equal-weight arithmetic average", () => {
  assert.equal(overallScore({ discovery: 8, qualification: 7, pitch: 6, buyingProcess: 4, nextStepExecution: 8 }), 6.6);
});

test("prompt protects first-call scoring from later pipeline bias", () => {
  assert.match(FIRST_CALL_SCORING_PROMPT, /Use only what the salesperson actually said/);
  assert.match(FIRST_CALL_SCORING_PROMPT, /Do not use Monday stage/);
  assert.match(FIRST_CALL_SCORING_PROMPT, /qualification decision with call quality/);
});
