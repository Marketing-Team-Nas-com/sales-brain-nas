// First-crawl guard.
//
// The very first crawl (no previous snapshot, e.g. after a deploy or a lost
// volume) and the first crawl of a newly configured board see every deal as
// "new". Those are baselines, not new leads. They must never land in the
// report change log (changes.jsonl), because Sales Pulse treats `created`
// rows as new leads and reads the last 180 rows with no date filter.
//
// Baseline rows are kept in a separate sidecar file for debugging, and report
// readers additionally drop any baseline-looking `created` rows that already
// exist on disk (the Nov 18 2026 Railway crawl wrote ~4,600 of them).
//
// Only type imports here so tests can load this file directly with node.
import type { SalesDeal } from "./monday";
import type { SalesMemoryChange, SalesMemorySnapshot } from "./sales-memory";

// A single crawl that "creates" at least this many deals is treated as a
// baseline by report readers, even if it was not tagged as one. Real bulk
// imports of this size would also be hidden from "new leads"; that is the
// conservative trade-off.
export const MASS_CREATED_THRESHOLD = 100;

export const trackedFields: Array<keyof SalesDeal> = [
  "owner",
  "email",
  "qualification",
  "initialOutreach",
  "callStage",
  "nextStepsStatus",
  "finalVerdict",
  "firstMeetingDate",
  "latestMeetingDate",
  "lastFollowUpDate",
  "budget",
  "agentNotes",
  "salesCallNotes",
  "followUp",
];

export type SnapshotDiff = {
  // Rows for changes.jsonl (what reports read).
  changes: SalesMemoryChange[];
  // `created` rows for deals seen as part of a baseline. Never written to
  // changes.jsonl.
  baseline: SalesMemoryChange[];
  // True when there was no usable previous snapshot.
  isFirstSnapshot: boolean;
  // Boards whose deals were all treated as baseline in this crawl.
  baselineBoardIds: string[];
};

export type CrawlLogEntry = {
  generatedAt: string;
  totalRecords?: number;
  changeCount?: number;
  baseline?: boolean;
};

export function diffSnapshots(
  previous: SalesMemorySnapshot | null,
  current: SalesMemorySnapshot,
): SnapshotDiff {
  const createdRow = (deal: SalesDeal, baseline: boolean): SalesMemoryChange => ({
    crawledAt: current.generatedAt,
    boardId: deal.boardId,
    itemId: deal.id,
    account: deal.account,
    field: "created",
    after: deal.stage,
    ...(baseline ? { baseline: true } : {}),
  });

  if (!previous || !previous.deals?.length) {
    return {
      changes: [],
      baseline: current.deals.map((deal) => createdRow(deal, true)),
      isFirstSnapshot: true,
      baselineBoardIds: uniqueBoardIds(current.deals),
    };
  }

  const changes: SalesMemoryChange[] = [];
  const baseline: SalesMemoryChange[] = [];
  const previousById = new Map(previous.deals.map((deal) => [dealKey(deal), deal]));
  const currentById = new Map(current.deals.map((deal) => [dealKey(deal), deal]));
  const knownBoards = knownBoardIds(previous);
  const baselineBoards = new Set<string>();

  for (const deal of current.deals) {
    const before = previousById.get(dealKey(deal));

    if (!before) {
      if (knownBoards.has(boardKey(deal))) {
        changes.push(createdRow(deal, false));
      } else {
        // First time this board shows up: its items are a baseline.
        baselineBoards.add(boardKey(deal));
        baseline.push(createdRow(deal, true));
      }
      continue;
    }

    for (const field of trackedFields) {
      const oldValue = stringifyDealValue(before[field]);
      const newValue = stringifyDealValue(deal[field]);

      if (oldValue !== newValue) {
        changes.push({
          crawledAt: current.generatedAt,
          boardId: deal.boardId,
          itemId: deal.id,
          account: deal.account,
          field,
          before: oldValue,
          after: newValue,
        });
      }
    }
  }

  for (const deal of previous.deals) {
    if (!currentById.has(dealKey(deal))) {
      changes.push({
        crawledAt: current.generatedAt,
        boardId: deal.boardId,
        itemId: deal.id,
        account: deal.account,
        field: "removed",
        before: deal.stage,
      });
    }
  }

  return {
    changes,
    baseline,
    isFirstSnapshot: false,
    baselineBoardIds: [...baselineBoards],
  };
}

// Crawl timestamps that were baselines. Covers new crawls tagged
// `baseline: true`, the first crawl ever logged (it had no previous snapshot),
// and legacy untagged crawls where nearly every record was logged as a change
// (the shape of a first-crawl flood).
export function baselineCrawlTimestamps(crawls: CrawlLogEntry[]) {
  const timestamps = new Set<string>();

  crawls.forEach((crawl, index) => {
    if (!crawl?.generatedAt) return;
    const total = crawl.totalRecords || 0;
    const changeCount = crawl.changeCount || 0;
    const looksLikeFlood = total >= 20 && changeCount >= total * 0.9;

    if (crawl.baseline || index === 0 || looksLikeFlood) {
      timestamps.add(crawl.generatedAt);
    }
  });

  return timestamps;
}

// Drop `created` rows that came from a baseline instead of a real new deal.
// Non-`created` rows (field changes, removals) are always kept.
export function excludeBaselineCreatedChanges(
  changes: SalesMemoryChange[],
  baselineCrawls: Set<string> = new Set(),
) {
  const createdPerCrawl = new Map<string, number>();

  for (const change of changes) {
    if (change.field === "created") {
      createdPerCrawl.set(change.crawledAt, (createdPerCrawl.get(change.crawledAt) || 0) + 1);
    }
  }

  return changes.filter((change) => {
    if (change.field !== "created") return true;
    if (change.baseline) return false;
    if (baselineCrawls.has(change.crawledAt)) return false;
    return (createdPerCrawl.get(change.crawledAt) || 0) < MASS_CREATED_THRESHOLD;
  });
}

// Boards the previous crawl actually read. A board counts as known when its id
// is in the previous snapshot's board list, even if it had zero deals then, so
// its first real deal is still logged as `created`. Deal board ids and the
// primary board are included for older snapshots without a `boards` list.
function knownBoardIds(previous: SalesMemorySnapshot) {
  const ids = new Set(previous.deals.map(boardKey));
  for (const board of previous.boards || []) {
    if (board?.id) ids.add(String(board.id));
  }
  if (previous.board?.id) ids.add(String(previous.board.id));
  return ids;
}

function uniqueBoardIds(deals: SalesDeal[]) {
  return [...new Set(deals.map(boardKey))];
}

function boardKey(deal: SalesDeal) {
  return deal.boardId || "unknown";
}

function dealKey(deal: SalesDeal) {
  return `${boardKey(deal)}:${deal.id}`;
}

function stringifyDealValue(value: unknown) {
  if (value === undefined || value === null) return "";
  return String(value);
}
