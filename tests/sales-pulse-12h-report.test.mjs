import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPulseDateRange,
  pulseWindowFor,
} from "../app/lib/sales-pulse-12h-report.ts";

test("formats pulse chat windows as dates only", () => {
  assert.equal(
    formatPulseDateRange(
      "2026-08-03T21:00:00+08:00",
      "2026-08-04T09:00:00+08:00",
    ),
    "3 Aug 2026 - 4 Aug 2026",
  );
});

test("uses a 12-hour window for ordinary 9 AM and 9 PM pulses", () => {
  assert.deepEqual(pulseWindowFor("2026-08-04T09:00:00+08:00"), {
    start: "2026-08-03T21:00:00+08:00",
    end: "2026-08-04T09:00:00+08:00",
  });
  assert.deepEqual(pulseWindowFor("2026-08-04T21:00:00+08:00"), {
    start: "2026-08-04T09:00:00+08:00",
    end: "2026-08-04T21:00:00+08:00",
  });
});

test("Monday 9 AM catches up from Saturday 9 PM while Sunday is off", () => {
  assert.deepEqual(pulseWindowFor("2026-08-03T09:00:00+08:00"), {
    start: "2026-08-01T21:00:00+08:00",
    end: "2026-08-03T09:00:00+08:00",
  });
});

test("rejects Sunday and non-scheduled times", () => {
  assert.throws(() => pulseWindowFor("2026-08-02T09:00:00+08:00"), /Monday through Saturday/);
  assert.throws(() => pulseWindowFor("2026-08-04T15:00:00+08:00"), /09:00 and 21:00/);
});
