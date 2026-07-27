import { sendLarkTextReport } from "./lark";
import type { SalesDeal } from "./monday";
import type { SalesMemoryChange, SalesContextNote } from "./sales-memory";
import {
  crawlSalesMemory,
  getConfiguredSalesBoardIds,
  getLatestSalesMemory,
  getRecentSalesMemoryChanges,
  getSalesContextNotes,
} from "./sales-memory";

const MAX_SECTION_ITEMS = 8;

export async function createDailyNewspaperReport({
  chatId,
  sendToChat = true,
  previewOnly = false,
}: {
  chatId?: string;
  sendToChat?: boolean;
  previewOnly?: boolean;
} = {}) {
  const boardIds = getConfiguredSalesBoardIds();
  const snapshot =
    (await getLatestSalesMemory()) || (boardIds.length ? await crawlSalesMemory(boardIds) : null);

  if (!snapshot) {
    throw new Error("No Sales Brain memory snapshot has been crawled yet.");
  }

  const today = singaporeDateKey();
  const recentChanges = (await getRecentSalesMemoryChanges(300)).filter(
    (change) => singaporeDateKey(change.crawledAt) === today,
  );
  const contextNotes = (await getSalesContextNotes(250)).filter(
    (note) => singaporeDateKey(note.createdAt) === today,
  );
  const report = buildDailyNewspaperText({
    dateKey: today,
    deals: snapshot.deals,
    changes: recentChanges,
    notes: contextNotes,
  });

  if (sendToChat) {
    const targetChatId =
      chatId ||
      process.env.LARK_DAILY_SUMMARY_CHAT_ID ||
      process.env.LARK_SALES_REPORT_CHAT_ID ||
      process.env.LARK_SALES_CHAT_ID;

    if (!targetChatId) {
      throw new Error("No Lark chat id configured for the daily newspaper summary.");
    }

    await sendLarkTextReport({
      chatId: targetChatId,
      text: report,
    });
  }

  return {
    ok: true,
    date: today,
    previewOnly,
    reportPreview: report.slice(0, 4000),
  };
}

function buildDailyNewspaperText({
  dateKey,
  deals,
  changes,
  notes,
}: {
  dateKey: string;
  deals: SalesDeal[];
  changes: SalesMemoryChange[];
  notes: SalesContextNote[];
}) {
  const callsToday = deals.filter((deal) => dateOnly(deal.firstMeetingDate) === dateKey);
  const happenedCalls = callsToday.filter(isHappenedCall);
  const sqlCalls = happenedCalls.filter((deal) => deal.callStage === "Sales Qualified");
  const emailNotes = notes.filter((note) => note.source === "email");
  const passiveChatNotes = notes.filter((note) => note.source === "lark-passive");

  return [
    `The Sales Brain Evening Edition - ${friendlyDate(dateKey)}`,
    "",
    topLine({ changes, emailNotes, happenedCalls, sqlCalls, passiveChatNotes }),
    "",
    "1. Monday CRM Movement",
    formatChanges(changes),
    "",
    "2. Client Emails Worth Reading",
    formatEmailNotes(emailNotes),
    "",
    "3. Calls Today",
    formatCalls(happenedCalls, sqlCalls),
    "",
    "4. Sales Chat Watchlist",
    formatPassiveNotes(passiveChatNotes),
  ].join("\n");
}

function topLine({
  changes,
  emailNotes,
  happenedCalls,
  sqlCalls,
  passiveChatNotes,
}: {
  changes: SalesMemoryChange[];
  emailNotes: SalesContextNote[];
  happenedCalls: SalesDeal[];
  sqlCalls: SalesDeal[];
  passiveChatNotes: SalesContextNote[];
}) {
  return [
    `Top line: ${changes.length} CRM changes, ${emailNotes.length} client emails captured, ${happenedCalls.length} calls likely happened, ${sqlCalls.length} became sales qualified, and ${passiveChatNotes.length} team chat notes were saved.`,
  ].join("\n");
}

function formatChanges(changes: SalesMemoryChange[]) {
  if (!changes.length) return "No tracked CRM movement captured today.";

  return changes
    .slice(-MAX_SECTION_ITEMS)
    .map((change) => {
      const before = clean(change.before || "blank");
      const after = clean(change.after || "blank");
      return `- ${change.account}: ${fieldLabel(change.field)} moved from ${before} to ${after}.`;
    })
    .join("\n");
}

function formatEmailNotes(notes: SalesContextNote[]) {
  if (!notes.length) return "No client emails captured today.";

  return notes
    .slice(-MAX_SECTION_ITEMS)
    .map((note) => {
      const subject = extractLine(note.note, "Email received") || "No subject";
      const from = extractLine(note.note, "From") || "unknown sender";
      const matched = note.account ? `Matched to ${note.account}.` : "No CRM match yet.";
      const preview = previewFromNote(note.note);
      return `- ${subject} from ${from}. ${matched}${preview ? ` ${preview}` : ""}`;
    })
    .join("\n");
}

function formatCalls(happenedCalls: SalesDeal[], sqlCalls: SalesDeal[]) {
  const header = `${happenedCalls.length} calls likely happened today. ${sqlCalls.length} are currently marked Sales Qualified.`;

  if (!happenedCalls.length) return header;

  const callLines = happenedCalls
    .slice(0, MAX_SECTION_ITEMS)
    .map((deal) => {
      const outcome = [
        deal.qualification && deal.qualification !== "5" ? deal.qualification : "",
        deal.callStage && deal.callStage !== "5" ? deal.callStage : "",
        deal.nextStepsStatus && deal.nextStepsStatus !== "5" ? deal.nextStepsStatus : "",
        deal.finalVerdict && deal.finalVerdict !== "5" ? deal.finalVerdict : "",
      ]
        .filter(Boolean)
        .join(" / ");
      const notes = clean(deal.salesCallNotes || deal.agentNotes || deal.nextStep || deal.lookingFor || "");
      return `- ${deal.account}: ${outcome || "no outcome entered"}${notes ? ` - ${notes}` : ""}`;
    });

  return [header, ...callLines].join("\n");
}

function formatPassiveNotes(notes: SalesContextNote[]) {
  if (!notes.length) return "No passive sales-chat insights captured today.";

  return notes
    .slice(-MAX_SECTION_ITEMS)
    .map((note) => {
      const account = note.account ? `${note.account}: ` : "";
      return `- ${account}${clean(note.note || note.rawText)}`;
    })
    .join("\n");
}

function extractLine(note: string, label: string) {
  const line = note
    .split("\n")
    .find((item) => item.toLowerCase().startsWith(`${label.toLowerCase()}:`));

  return line?.replace(new RegExp(`^${label}:\\s*`, "i"), "").trim() || "";
}

function previewFromNote(note: string) {
  return clean(
    note
      .split("\n")
      .filter((line) => !/^(email received|from|date|matched crm record|no crm record matched yet):?/i.test(line))
      .join(" "),
  );
}

function isHappenedCall(deal: SalesDeal) {
  return ![deal.callStage, deal.nextStepsStatus, deal.finalVerdict].some((value) =>
    ["No Show", "Cancelled", "Canceled", "Reschedule", "Rescheduled"].includes(value),
  );
}

function dateOnly(value: string) {
  if (!value) return "";
  const direct = value.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (direct) return direct;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : singaporeDateKey(parsed);
}

function singaporeDateKey(value: Date | string = new Date()) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function friendlyDate(dateKey: string) {
  const parsed = new Date(`${dateKey}T00:00:00+08:00`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Singapore",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function fieldLabel(field: SalesMemoryChange["field"]) {
  return String(field)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (char) => char.toUpperCase());
}

function clean(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}
