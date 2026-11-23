import { mkdir, readFile, rename, writeFile, appendFile, unlink, open } from "node:fs/promises";
import path from "node:path";
import type { SalesDeal } from "./monday";
import { getBoardSnapshot } from "./monday";
import {
  baselineCrawlTimestamps,
  diffSnapshots,
  excludeBaselineCreatedChanges,
} from "./first-crawl-guard";
import type { CrawlLogEntry, SnapshotDiff } from "./first-crawl-guard";

export type SalesMemorySnapshot = {
  id: string;
  generatedAt: string;
  board: {
    id: string;
    name: string;
  };
  boards?: Array<{
    id: string;
    name: string;
  }>;
  summary: SalesMemorySummary;
  deals: SalesDeal[];
};

export type SalesMemorySummary = {
  totalRecords: number;
  byQualification: Record<string, number>;
  byInitialOutreach: Record<string, number>;
  byCallStage: Record<string, number>;
  byNextSteps: Record<string, number>;
  byFinalVerdict: Record<string, number>;
  byOwner: Record<string, number>;
  missing: {
    owner: number;
    email: number;
    agentNotes: number;
    nextStep: number;
    lastFollowUp: number;
  };
};

export type SalesMemoryChange = {
  crawledAt: string;
  boardId?: string;
  itemId: string;
  account: string;
  field: keyof SalesDeal | "created" | "removed";
  before?: string;
  after?: string;
  // Set on `created` rows that are part of a first-crawl / first-board
  // baseline. Those rows go to changes.baseline.jsonl, not changes.jsonl.
  baseline?: true;
};

export type ConversationMessage = {
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};

export type PendingMondayAction = {
  id: string;
  createdAt: string;
  boardId: string;
  itemId: string;
  account: string;
  email: string;
  description: string;
  columnValues?: Record<string, unknown>;
  updateBody?: string;
  bulkActions?: Array<{
    boardId: string;
    itemId: string;
    account: string;
    email: string;
    description: string;
    columnValues?: Record<string, unknown>;
    updateBody?: string;
    createUpdate?: boolean;
  }>;
  disambiguation?: {
    candidateItemIds: string[];
    updateKind?:
      | "lost"
      | "signed-stage"
      | "agreement-stage"
      | "second-call-booked"
      | "meeting-booked"
      | "sales-qualified"
      | "sales-qualified-proposal"
      | "proposal-stage"
      | "cmo-proposal-stage"
      | "proposal-done";
    updateBody?: string;
    threadNote?: string;
  };
};

export type SalesContextNote = {
  id: string;
  createdAt: string;
  threadId: string;
  source: "lark" | "lark-passive" | "email";
  rawText: string;
  note: string;
  account?: string;
  itemId?: string;
  email?: string;
};

let activeCrawl: Promise<SalesMemorySnapshot> | null = null;

export function getConfiguredSalesBoardIds() {
  const configured =
    process.env.MONDAY_SALES_BOARD_IDS ||
    [process.env.MONDAY_SALES_BOARD_ID, process.env.MONDAY_ADDITIONAL_SALES_BOARD_IDS || "5030120019"]
      .filter(Boolean)
      .join(",");

  return [
    ...new Set(
      configured
        .split(",")
        .map((boardId) => boardId.trim())
        .filter(Boolean),
    ),
  ];
}

export async function crawlSalesMemory(boardIds: string | string[]) {
  if (activeCrawl) return activeCrawl;

  const ids = Array.isArray(boardIds) ? boardIds : [boardIds];
  activeCrawl = crawlAndStore(ids).finally(() => {
    activeCrawl = null;
  });

  return activeCrawl;
}

export async function getLatestSalesMemory() {
  try {
    const raw = await readFile(memoryPath("latest.json"), "utf8");
    return JSON.parse(raw) as SalesMemorySnapshot;
  } catch {
    return null;
  }
}

export async function getRecentSalesMemoryChanges(limit = 100) {
  try {
    const raw = await readFile(memoryPath("changes.jsonl"), "utf8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line) as SalesMemoryChange);
  } catch {
    return [];
  }
}

// Change rows that are safe for reports: first-crawl / first-board baseline
// `created` rows are dropped (including untagged legacy ones already on disk),
// then the last `limit` rows are returned. Field changes and removals are
// never dropped.
export async function getReportableSalesMemoryChanges(limit = 100) {
  const all = await getRecentSalesMemoryChanges(Number.MAX_SAFE_INTEGER);
  const baselineCrawls = baselineCrawlTimestamps(await getCrawlLog());
  return excludeBaselineCreatedChanges(all, baselineCrawls).slice(-limit);
}

async function getCrawlLog() {
  try {
    const raw = await readFile(memoryPath("crawls.jsonl"), "utf8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as CrawlLogEntry];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

export async function getConversationMemory(threadId: string) {
  try {
    const raw = await readFile(conversationPath(threadId), "utf8");
    const messages = JSON.parse(raw) as ConversationMessage[];
    return messages.slice(-12);
  } catch {
    return [];
  }
}

export async function appendConversationMemory({
  threadId,
  userMessage,
  assistantMessage,
}: {
  threadId: string;
  userMessage: string;
  assistantMessage: string;
}) {
  const dir = path.join(memoryDir(), "conversations");
  await mkdir(dir, { recursive: true });

  const existing = await getConversationMemory(threadId);
  const now = new Date().toISOString();
  const messages = [
    ...existing,
    { role: "user", text: userMessage, createdAt: now },
    { role: "assistant", text: assistantMessage, createdAt: now },
  ] satisfies ConversationMessage[];

  const trimmed = messages.slice(-20);
  const tempPath = `${conversationPath(threadId)}.${process.pid}.tmp`;
  await writeFile(tempPath, JSON.stringify(trimmed, null, 2));
  await rename(tempPath, conversationPath(threadId));
}

export async function getPendingMondayAction(threadId: string) {
  try {
    const raw = await readFile(pendingActionPath(threadId), "utf8");
    return JSON.parse(raw) as PendingMondayAction;
  } catch {
    return null;
  }
}

export async function setPendingMondayAction(
  threadId: string,
  action: PendingMondayAction,
) {
  const dir = path.join(memoryDir(), "pending-actions");
  await mkdir(dir, { recursive: true });

  const tempPath = `${pendingActionPath(threadId)}.${process.pid}.tmp`;
  await writeFile(tempPath, JSON.stringify(action, null, 2));
  await rename(tempPath, pendingActionPath(threadId));
}

export async function clearPendingMondayAction(threadId: string) {
  try {
    await unlink(pendingActionPath(threadId));
  } catch {}
}

export async function appendSalesContextNote(note: Omit<SalesContextNote, "id" | "createdAt">) {
  const entry: SalesContextNote = {
    ...note,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
  };

  const dir = memoryDir();
  await mkdir(dir, { recursive: true });
  await appendFile(memoryPath("sales-context-notes.jsonl"), `${JSON.stringify(entry)}\n`);

  return entry;
}

export async function getSalesContextNotes(limit = 80) {
  try {
    const raw = await readFile(memoryPath("sales-context-notes.jsonl"), "utf8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line) as SalesContextNote);
  } catch {
    return [];
  }
}

export async function registerLarkMessageDelivery(messageId: string) {
  const dir = path.join(memoryDir(), "processed-lark-messages");
  await mkdir(dir, { recursive: true });

  const filePath = path.join(dir, `${safeFileName(messageId)}.json`);

  try {
    const file = await open(filePath, "wx");
    await file.writeFile(
      JSON.stringify({
        messageId,
        processedAt: new Date().toISOString(),
      }),
    );
    await file.close();
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      return false;
    }

    throw error;
  }
}

async function crawlAndStore(boardIds: string[]) {
  const previous = await getLatestSalesMemory();
  const snapshots = await Promise.all(boardIds.map((boardId) => getBoardSnapshot(boardId)));
  const boards = snapshots
    .map((snapshot) => snapshot.board)
    .filter(Boolean)
    .map((board) => ({
      id: board.id,
      name: board.name,
    }));
  const deals = snapshots.flatMap((snapshot) => snapshot.deals);

  if (!boards.length) {
    throw new Error("monday board was not found.");
  }

  const generatedAt = new Date().toISOString();
  const snapshot: SalesMemorySnapshot = {
    id: generatedAt.replace(/[:.]/g, "-"),
    generatedAt,
    board: {
      id: boards[0].id,
      name: boards.length > 1 ? `${boards.length} monday boards` : boards[0].name,
    },
    boards,
    summary: buildSummary(deals),
    deals,
  };

  const diff = diffSnapshots(previous, snapshot);
  await writeSnapshot(snapshot, diff);
  return snapshot;
}

function buildSummary(deals: SalesDeal[]): SalesMemorySummary {
  return {
    totalRecords: deals.length,
    byQualification: countBy(deals, (deal) => deal.qualification || "Blank"),
    byInitialOutreach: countBy(deals, (deal) => deal.initialOutreach || "Blank"),
    byCallStage: countBy(deals, (deal) => deal.callStage || "Blank"),
    byNextSteps: countBy(deals, (deal) => deal.nextStepsStatus || "Blank"),
    byFinalVerdict: countBy(deals, (deal) => deal.finalVerdict || "Blank"),
    byOwner: countBy(deals, (deal) => deal.owner || "Unassigned"),
    missing: {
      owner: deals.filter((deal) => !deal.owner || deal.owner === "Unassigned").length,
      email: deals.filter((deal) => !deal.email).length,
      agentNotes: deals.filter((deal) => !deal.agentNotes).length,
      nextStep: deals.filter((deal) => !deal.nextStepsStatus && !deal.followUp).length,
      lastFollowUp: deals.filter((deal) => !deal.lastFollowUpDate).length,
    },
  };
}

async function writeSnapshot(snapshot: SalesMemorySnapshot, diff: SnapshotDiff) {
  const { changes, baseline } = diff;
  const dir = memoryDir();
  await mkdir(dir, { recursive: true });

  const latestPath = memoryPath("latest.json");
  const tempPath = memoryPath(`latest.${process.pid}.tmp`);
  await writeFile(tempPath, JSON.stringify(snapshot, null, 2));
  await rename(tempPath, latestPath);

  const crawlLog = {
    id: snapshot.id,
    generatedAt: snapshot.generatedAt,
    totalRecords: snapshot.summary.totalRecords,
    changeCount: changes.length,
    baseline: diff.isFirstSnapshot,
    baselineCount: baseline.length,
    baselineBoardIds: diff.baselineBoardIds,
    summary: snapshot.summary,
  };

  await appendFile(memoryPath("crawls.jsonl"), `${JSON.stringify(crawlLog)}\n`);

  if (changes.length) {
    await appendFile(
      memoryPath("changes.jsonl"),
      `${changes.map((change) => JSON.stringify(change)).join("\n")}\n`,
    );
  }

  // Baseline rows are kept for debugging only. Reports never read this file.
  if (baseline.length) {
    await appendFile(
      memoryPath("changes.baseline.jsonl"),
      `${baseline.map((change) => JSON.stringify(change)).join("\n")}\n`,
    );
  }
}

function countBy<T>(items: T[], keyFor: (item: T) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = keyFor(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function memoryPath(fileName: string) {
  return path.join(memoryDir(), fileName);
}

function conversationPath(threadId: string) {
  return path.join(memoryDir(), "conversations", `${safeFileName(threadId)}.json`);
}

function pendingActionPath(threadId: string) {
  return path.join(memoryDir(), "pending-actions", `${safeFileName(threadId)}.json`);
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function memoryDir() {
  return process.env.SALES_BRAIN_MEMORY_DIR || path.join(process.cwd(), ".sales-brain-memory");
}
