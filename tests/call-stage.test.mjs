import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CALL_STAGE_PENDING_DISPLAY,
  CALL_STAGE_PENDING_LABELS,
  countCallStagePending,
  isCallStagePending,
  mentionsCallStagePending,
} from "../app/lib/call-stage.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("treats renamed Pending and legacy In Review as the same Call Stage", () => {
  assert.deepEqual(CALL_STAGE_PENDING_LABELS, ["Pending", "In Review"]);
  assert.equal(isCallStagePending("Pending"), true);
  assert.equal(isCallStagePending("In Review"), true);
  assert.equal(isCallStagePending("Sales Qualified"), false);
  assert.equal(isCallStagePending("Booked a Meeting"), false);
  assert.equal(isCallStagePending(""), false);
});

test("keeps the existing exact, case-sensitive label matching", () => {
  assert.equal(isCallStagePending("pending"), false);
  assert.equal(isCallStagePending("in review"), false);
  assert.equal(isCallStagePending(" Pending"), false);
});

test("counts both labels so old snapshots and renamed items add up", () => {
  assert.equal(countCallStagePending({}), 0);
  assert.equal(countCallStagePending({ "In Review": 3 }), 3);
  assert.equal(countCallStagePending({ Pending: 2 }), 2);
  assert.equal(
    countCallStagePending({ Pending: 2, "In Review": 3, "Booked a Meeting": 7, "Sales Qualified": 4 }),
    5,
  );
});

test("recognises Pending, In Review, and review in bot questions", () => {
  assert.equal(mentionsCallStagePending("list fit calls that happened and are sql or pending"), true);
  assert.equal(mentionsCallStagePending("list fit calls that happened and are sql or in review"), true);
  assert.equal(mentionsCallStagePending("show fit leads for review"), true);
  assert.equal(mentionsCallStagePending("list fit calls that happened and are sql"), false);
});

test("scorecard counts both labels in the not-SQL bucket and call activity", async () => {
  const scorecard = await source("app/lib/marketing-scorecard.ts");
  assert.match(scorecard, /const callStagePending = countCallStagePending\(sheet\.allByStage\);/);
  assert.match(scorecard, /\.\.\.CALL_STAGE_PENDING_LABELS,/);
  assert.doesNotMatch(scorecard, /"In Review"/);

  // SQL rate base must still leave Call Stage Pending out.
  assert.match(
    scorecard,
    /const decidedCallBase = salesQualified \+ notQualified \+ noShows \+ rescheduled \+ cancelled;/,
  );
});

test("bot filters use the alias helper instead of the literal label", async () => {
  const salesBrain = await source("app/lib/sales-brain.ts");
  assert.match(salesBrain, /deal\.callStage === "Sales Qualified" \|\| isCallStagePending\(deal\.callStage\)/);
  assert.match(salesBrain, /matches\.filter\(\(deal\) => isCallStagePending\(deal\.callStage\)\)/);
  assert.match(salesBrain, /mentionsCallStagePending\(normalizedQuestion\)/);
  assert.doesNotMatch(salesBrain, /\["Sales Qualified", "In Review"\]/);
  assert.doesNotMatch(salesBrain, /callStage === "In Review"/);
  assert.equal(CALL_STAGE_PENDING_DISPLAY, "Call Stage Pending (formerly In Review)");
});

test("scorecard copy keeps Call Stage Pending apart from booked meetings not held yet", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /label="Call Stage Pending \(formerly In Review\), not counted as SQL" value=\{daily\.callStagePending\}/);
  assert.match(page, /label="Call Stage Pending \(formerly In Review\), not counted as SQL" value=\{rolling\.callStagePending\}/);
  assert.match(page, /label="Booked meetings, not held yet" value=\{rolling\.bookedMeetings\}/);
  assert.match(page, /SQL rate excluding Call Stage Pending \(formerly In Review\)/);
  assert.doesNotMatch(page, /Pending calls/);
  assert.doesNotMatch(page, /pending calls/);
});
