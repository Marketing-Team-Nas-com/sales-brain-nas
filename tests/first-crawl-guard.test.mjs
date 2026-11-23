import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MASS_CREATED_THRESHOLD,
  baselineCrawlTimestamps,
  diffSnapshots,
  excludeBaselineCreatedChanges,
} from "../app/lib/first-crawl-guard.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const BOARD_A = "1111";
const BOARD_B = "2222";

function deal(id, boardId, overrides = {}) {
  return {
    id,
    boardId,
    account: `Account ${id}`,
    stage: "New",
    owner: "Ana",
    callStage: "Pending",
    ...overrides,
  };
}

function snapshot(generatedAt, deals, boardIds) {
  return {
    id: generatedAt,
    generatedAt,
    board: { id: BOARD_A, name: "Sales" },
    ...(boardIds ? { boards: boardIds.map((id) => ({ id, name: `Board ${id}` })) } : {}),
    deals,
  };
}

const crawl1 = "2026-11-20T01:00:00.000Z";
const crawl2 = "2026-11-20T01:10:00.000Z";
const crawl3 = "2026-11-20T01:20:00.000Z";

test("missing previous snapshot: no created rows for the report change log", () => {
  const current = snapshot(crawl1, [deal("1", BOARD_A), deal("2", BOARD_A), deal("3", BOARD_B)]);
  const diff = diffSnapshots(null, current);

  assert.equal(diff.isFirstSnapshot, true);
  assert.deepEqual(diff.changes, []);
  assert.equal(diff.baseline.length, 3);
  assert.ok(diff.baseline.every((row) => row.field === "created" && row.baseline === true));
  assert.deepEqual(diff.baselineBoardIds.sort(), [BOARD_A, BOARD_B]);
});

test("empty previous snapshot is treated like a missing one", () => {
  const diff = diffSnapshots(snapshot(crawl1, []), snapshot(crawl2, [deal("1", BOARD_A)]));

  assert.equal(diff.isFirstSnapshot, true);
  assert.deepEqual(diff.changes, []);
  assert.equal(diff.baseline.length, 1);
});

test("a board seen for the first time does not log every item as created", () => {
  const previous = snapshot(crawl1, [deal("1", BOARD_A)]);
  const boardBDeals = Array.from({ length: 250 }, (_, i) => deal(`b${i}`, BOARD_B));
  const current = snapshot(crawl2, [deal("1", BOARD_A), ...boardBDeals]);
  const diff = diffSnapshots(previous, current);

  assert.equal(diff.isFirstSnapshot, false);
  assert.deepEqual(diff.changes, []);
  assert.equal(diff.baseline.length, 250);
  assert.deepEqual(diff.baselineBoardIds, [BOARD_B]);
});

test("a newly configured board absent from the previous board list is a baseline", () => {
  const previous = snapshot(crawl1, [deal("1", BOARD_A)], [BOARD_A]);
  const boardBDeals = Array.from({ length: 30 }, (_, i) => deal(`b${i}`, BOARD_B));
  const diff = diffSnapshots(previous, snapshot(crawl2, [deal("1", BOARD_A), ...boardBDeals], [BOARD_A, BOARD_B]));

  assert.deepEqual(diff.changes, []);
  assert.equal(diff.baseline.length, 30);
  assert.deepEqual(diff.baselineBoardIds, [BOARD_B]);
});

test("a known board that had zero deals last crawl still logs its first real deal", () => {
  // Board B was read last crawl (it is in the board list) but had no items.
  const previous = snapshot(crawl2, [deal("1", BOARD_A)], [BOARD_A, BOARD_B]);
  const current = snapshot(crawl3, [deal("1", BOARD_A), deal("b1", BOARD_B)], [BOARD_A, BOARD_B]);
  const diff = diffSnapshots(previous, current);

  assert.deepEqual(diff.baseline, []);
  assert.deepEqual(diff.baselineBoardIds, []);
  assert.equal(diff.changes.length, 1);
  assert.equal(diff.changes[0].field, "created");
  assert.equal(diff.changes[0].boardId, BOARD_B);
  assert.equal(diff.changes[0].itemId, "b1");
  assert.equal(diff.changes[0].baseline, undefined);
});

test("after a good baseline, a real new deal logs exactly one created row", () => {
  const previous = snapshot(crawl2, [deal("1", BOARD_A), deal("b1", BOARD_B)]);
  const current = snapshot(crawl3, [deal("1", BOARD_A), deal("b1", BOARD_B), deal("2", BOARD_A)]);
  const diff = diffSnapshots(previous, current);

  assert.deepEqual(diff.baseline, []);
  assert.equal(diff.changes.length, 1);
  assert.deepEqual(diff.changes[0], {
    crawledAt: crawl3,
    boardId: BOARD_A,
    itemId: "2",
    account: "Account 2",
    field: "created",
    after: "New",
  });
});

test("a later field change logs a normal change row", () => {
  const previous = snapshot(crawl2, [deal("1", BOARD_A)]);
  const current = snapshot(crawl3, [deal("1", BOARD_A, { callStage: "Sales Qualified" })]);
  const diff = diffSnapshots(previous, current);

  assert.deepEqual(diff.baseline, []);
  assert.deepEqual(diff.changes, [
    {
      crawledAt: crawl3,
      boardId: BOARD_A,
      itemId: "1",
      account: "Account 1",
      field: "callStage",
      before: "Pending",
      after: "Sales Qualified",
    },
  ]);
});

test("removed deals on known boards are still logged", () => {
  const previous = snapshot(crawl2, [deal("1", BOARD_A), deal("2", BOARD_A)]);
  const diff = diffSnapshots(previous, snapshot(crawl3, [deal("1", BOARD_A)]));

  assert.equal(diff.changes.length, 1);
  assert.equal(diff.changes[0].field, "removed");
  assert.equal(diff.changes[0].itemId, "2");
});

test("report filter drops tagged baseline rows but keeps real ones", () => {
  const rows = [
    { crawledAt: crawl1, itemId: "1", account: "A", field: "created", baseline: true },
    { crawledAt: crawl3, itemId: "2", account: "B", field: "created" },
    { crawledAt: crawl3, itemId: "1", account: "A", field: "callStage", before: "x", after: "y" },
  ];

  assert.deepEqual(
    excludeBaselineCreatedChanges(rows).map((row) => row.itemId + ":" + row.field),
    ["2:created", "1:callStage"],
  );
});

test("report filter drops created rows from a recorded baseline crawl", () => {
  const rows = [
    { crawledAt: crawl1, itemId: "1", account: "A", field: "created" },
    { crawledAt: crawl1, itemId: "1", account: "A", field: "owner", before: "a", after: "b" },
    { crawledAt: crawl3, itemId: "2", account: "B", field: "created" },
  ];
  const kept = excludeBaselineCreatedChanges(rows, new Set([crawl1]));

  assert.deepEqual(kept.map((row) => row.itemId + ":" + row.field), ["1:owner", "2:created"]);
});

test("report filter drops an untagged legacy mass-created crawl (Nov 18 shape)", () => {
  const legacy = Array.from({ length: MASS_CREATED_THRESHOLD }, (_, i) => ({
    crawledAt: crawl1,
    itemId: `${i}`,
    account: `A${i}`,
    field: "created",
  }));
  const real = { crawledAt: crawl3, itemId: "new", account: "Real Lead", field: "created" };
  const kept = excludeBaselineCreatedChanges([...legacy, real]);

  assert.deepEqual(kept, [real]);
});

test("small batches of real created rows are kept", () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    crawledAt: crawl3,
    itemId: `${i}`,
    account: `A${i}`,
    field: "created",
  }));

  assert.equal(excludeBaselineCreatedChanges(rows).length, 5);
});

test("baseline crawls are detected from the crawl log", () => {
  const crawls = [
    { generatedAt: "first", totalRecords: 10, changeCount: 0 },
    { generatedAt: "normal", totalRecords: 4600, changeCount: 3 },
    { generatedAt: "legacy-flood", totalRecords: 4600, changeCount: 4600 },
    { generatedAt: "tagged", totalRecords: 4600, changeCount: 0, baseline: true },
    { generatedAt: "small", totalRecords: 5, changeCount: 5 },
  ];

  assert.deepEqual(
    [...baselineCrawlTimestamps(crawls)].sort(),
    ["first", "legacy-flood", "tagged"],
  );
});

test("leftover Nov 18 live rows are hidden; later real activity is kept", () => {
  // Mirrors the live volume: the first successful crawl on Nov 18 logged every
  // deal as `created` with one shared timestamp, before this guard existed.
  const nov18 = "2026-11-18T06:47:12.000Z";
  const later = ["2026-11-20T01:00:00.000Z", "2026-11-20T01:10:00.000Z"];
  const legacy = Array.from({ length: 4600 }, (_, i) => ({
    crawledAt: nov18,
    boardId: i % 2 ? BOARD_A : BOARD_B,
    itemId: `${i}`,
    account: `Legacy ${i}`,
    field: "created",
    after: "New",
  }));
  const realActivity = [
    { crawledAt: later[0], boardId: BOARD_A, itemId: "new-1", account: "Real Lead", field: "created", after: "New" },
    { crawledAt: later[0], boardId: BOARD_A, itemId: "7", account: "Legacy 7", field: "callStage", before: "Pending", after: "Booked" },
    { crawledAt: later[1], boardId: BOARD_B, itemId: "new-2", account: "Real Lead 2", field: "created", after: "New" },
    { crawledAt: later[1], boardId: BOARD_B, itemId: "8", account: "Legacy 8", field: "removed", before: "New" },
  ];
  const crawlLog = [
    { generatedAt: nov18, totalRecords: 4600, changeCount: 4600 },
    { generatedAt: later[0], totalRecords: 4601, changeCount: 2 },
    { generatedAt: later[1], totalRecords: 4601, changeCount: 2 },
  ];
  const all = [...legacy, ...realActivity];

  // Same path as getReportableSalesMemoryChanges(180).
  const reportable = excludeBaselineCreatedChanges(all, baselineCrawlTimestamps(crawlLog)).slice(-180);
  assert.deepEqual(reportable, realActivity);

  // Still hidden if crawls.jsonl is missing or does not flag the crawl.
  assert.deepEqual(excludeBaselineCreatedChanges(all), realActivity);

  // Field changes and removals in the legacy crawl itself are never dropped.
  const legacyEdit = { crawledAt: nov18, itemId: "1", account: "Legacy 1", field: "owner", before: "a", after: "b" };
  assert.deepEqual(
    excludeBaselineCreatedChanges([...legacy, legacyEdit], baselineCrawlTimestamps(crawlLog)),
    [legacyEdit],
  );
});

test("ordinary new leads after a good baseline are not hidden by the filter", () => {
  const crawlLog = [
    { generatedAt: crawl1, totalRecords: 4600, changeCount: 0, baseline: true },
    { generatedAt: crawl2, totalRecords: 4640, changeCount: 40 },
    { generatedAt: crawl3, totalRecords: 4740, changeCount: MASS_CREATED_THRESHOLD - 1 },
  ];
  const rows = [
    ...Array.from({ length: 40 }, (_, i) => ({ crawledAt: crawl2, itemId: `a${i}`, account: "A", field: "created" })),
    ...Array.from({ length: MASS_CREATED_THRESHOLD - 1 }, (_, i) => ({ crawledAt: crawl3, itemId: `b${i}`, account: "B", field: "created" })),
  ];

  assert.equal(excludeBaselineCreatedChanges(rows, baselineCrawlTimestamps(crawlLog)).length, rows.length);
});

test("reports read baseline-filtered changes, not the raw log", async () => {
  const pulse = await source("app/lib/twice-weekly-report.ts");
  const newspaper = await source("app/lib/daily-newspaper-report.ts");
  const ceoRoute = await source("app/api/lark/ceo-report/route.ts");
  const ceoReport = await source("app/lib/ceo-report.ts");

  for (const file of [pulse, newspaper, ceoRoute]) {
    assert.match(file, /getReportableSalesMemoryChanges\(/);
    assert.doesNotMatch(file, /getRecentSalesMemoryChanges\(/);
  }
  assert.match(ceoReport, /excludeBaselineCreatedChanges\(changes\)/);
});

test("crawl writer keeps baseline rows out of changes.jsonl and has no send path", async () => {
  const memory = await source("app/lib/sales-memory.ts");

  assert.match(memory, /changes\.baseline\.jsonl/);
  assert.doesNotMatch(memory, /from "\.\/lark"/);
  assert.doesNotMatch(memory, /sendLark|sendMail|sendEmail|change_column_value|create_update/);
});
