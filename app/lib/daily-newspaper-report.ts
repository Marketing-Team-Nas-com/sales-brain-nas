import {
  appendLarkDocumentTextBlocks,
  appendLarkReportBlocks,
  createLarkDocument,
  sendLarkTextReport,
} from "./lark";
import type { LarkReportBlock } from "./lark";
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
const MAX_AI_INPUT_ITEMS = 24;

type DailyNewspaper = {
  title: string;
  subtitle: string;
  topLine: string;
  keyNumbers: Array<{ metric: string; value: string; note: string }>;
  crmMovements: string[];
  clientEmails: string[];
  calls: string[];
  teamNotes: string[];
  executiveNote: string;
};

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
  const facts = buildDailyFacts({
    dateKey: today,
    deals: snapshot.deals,
    changes: recentChanges,
    notes: contextNotes,
  });
  const newspaper = await buildSmartDailyNewspaper(facts);
  const plainText = dailyNewspaperPlainText(newspaper);

  if (previewOnly) {
    return {
      ok: true,
      date: today,
      previewOnly,
      document: null,
      reportPreview: plainText.slice(0, 4000),
    };
  }

  const document = await createLarkDocument({ title: newspaper.title });
  let writeMode = "rich-blocks";
  let writeError = "";

  try {
    await appendLarkReportBlocks({
      documentId: document.documentId,
      blocks: dailyNewspaperBlocks(newspaper),
    });
  } catch (error) {
    writeMode = "text-blocks";
    writeError = error instanceof Error ? error.message : "Rich Lark blocks failed.";
    await appendLarkDocumentTextBlocks({
      documentId: document.documentId,
      paragraphs: dailyNewspaperParagraphs(newspaper),
    });
  }

  const targetChatId =
    chatId ||
    process.env.LARK_DAILY_SUMMARY_CHAT_ID ||
    process.env.LARK_SALES_REPORT_CHAT_ID ||
    process.env.LARK_SALES_CHAT_ID;

  if (sendToChat) {
    if (!targetChatId) {
      throw new Error("No Lark chat id configured for the daily newspaper summary.");
    }

    await sendLarkTextReport({
      chatId: targetChatId,
      text: [
        `${newspaper.title}`,
        newspaper.topLine,
        "",
        `Read the newspaper: ${document.url}`,
      ].join("\n"),
    });
  }

  return {
    ok: true,
    date: today,
    previewOnly,
    document,
    writeMode,
    writeError,
    reportPreview: plainText.slice(0, 4000),
  };
}

function buildDailyFacts({
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

  return {
    dateKey,
    friendlyDate: friendlyDate(dateKey),
    counts: {
      crmChanges: changes.length,
      emails: emailNotes.length,
      callsLikelyHappened: happenedCalls.length,
      salesQualifiedCalls: sqlCalls.length,
      teamNotes: passiveChatNotes.length,
    },
    crmChanges: changes.slice(-MAX_AI_INPUT_ITEMS).map(formatChangeLine),
    emails: emailNotes.slice(-MAX_AI_INPUT_ITEMS).map(formatEmailNoteLine),
    calls: happenedCalls.slice(0, MAX_AI_INPUT_ITEMS).map(formatCallLine),
    teamNotes: passiveChatNotes.slice(-MAX_AI_INPUT_ITEMS).map(formatPassiveNoteLine),
  };
}

async function buildSmartDailyNewspaper(facts: ReturnType<typeof buildDailyFacts>) {
  const fallback = fallbackDailyNewspaper(facts);

  if (!process.env.OPENAI_API_KEY) {
    return fallback;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
        reasoning: {
          effort: process.env.OPENAI_REASONING_EFFORT || "medium",
        },
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: [
                  "You are Harry, the Sales Brain editor for Nas Daily.",
                  "Turn raw CRM, email, call, and team-chat facts into a concise end-of-day sales newspaper for executives.",
                  "Only include key updates. Remove test emails, noise, duplicate rows, and low-value system movements.",
                  "Do not invent facts. If something is unclear, omit it or state it conservatively.",
                  "Write in clean, normal English with a sharp editorial voice. No markdown.",
                  "Return only valid JSON matching this shape:",
                  JSON.stringify(fallback),
                ].join("\n"),
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify(facts),
              },
            ],
          },
        ],
      }),
    });

    const payload = (await response.json()) as {
      error?: { message?: string };
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };

    if (!response.ok) {
      throw new Error(payload.error?.message || `OpenAI returned HTTP ${response.status}`);
    }

    const parsed = parseNewspaperJson(extractResponseText(payload));
    return normalizeDailyNewspaper(parsed, fallback);
  } catch (error) {
    console.error("Daily newspaper OpenAI edit failed", error);
    return fallback;
  }
}

function fallbackDailyNewspaper(facts: ReturnType<typeof buildDailyFacts>): DailyNewspaper {
  return {
    title: `The Sales Brain Evening Edition - ${facts.friendlyDate}`,
    subtitle: "A tight end-of-day read on what moved, who replied, and what needs attention.",
    topLine: `${facts.counts.crmChanges} CRM changes, ${facts.counts.emails} client emails, ${facts.counts.callsLikelyHappened} calls likely happened, ${facts.counts.salesQualifiedCalls} became sales qualified, and ${facts.counts.teamNotes} team notes were captured.`,
    keyNumbers: [
      { metric: "CRM changes", value: String(facts.counts.crmChanges), note: "Tracked today" },
      { metric: "Client emails", value: String(facts.counts.emails), note: "Captured today" },
      {
        metric: "Calls happened",
        value: String(facts.counts.callsLikelyHappened),
        note: "Excludes no-show, cancelled, and rescheduled",
      },
      {
        metric: "Sales qualified",
        value: String(facts.counts.salesQualifiedCalls),
        note: "From calls that likely happened today",
      },
    ],
    crmMovements: facts.crmChanges.slice(-MAX_SECTION_ITEMS),
    clientEmails: facts.emails
      .filter((line) => !/\b(test|hi$|werf)/i.test(line))
      .slice(-5),
    calls: facts.calls.slice(0, 6),
    teamNotes: facts.teamNotes.slice(-5),
    executiveNote: "The day had enough activity to monitor, but only the cleanest signal should be carried forward.",
  };
}

function normalizeDailyNewspaper(value: Partial<DailyNewspaper>, fallback: DailyNewspaper): DailyNewspaper {
  return {
    title: cleanLong(value.title || fallback.title, 120),
    subtitle: cleanLong(value.subtitle || fallback.subtitle, 220),
    topLine: cleanLong(value.topLine || fallback.topLine, 420),
    keyNumbers: Array.isArray(value.keyNumbers) && value.keyNumbers.length
      ? value.keyNumbers.slice(0, 6).map((item) => ({
          metric: cleanLong(String(item.metric || ""), 60),
          value: cleanLong(String(item.value || ""), 40),
          note: cleanLong(String(item.note || ""), 120),
        }))
      : fallback.keyNumbers,
    crmMovements: cleanList(value.crmMovements, fallback.crmMovements, 6),
    clientEmails: cleanList(value.clientEmails, fallback.clientEmails, 5),
    calls: cleanList(value.calls, fallback.calls, 6),
    teamNotes: cleanList(value.teamNotes, fallback.teamNotes, 5),
    executiveNote: cleanLong(value.executiveNote || fallback.executiveNote, 420),
  };
}

function parseNewspaperJson(text: string): Partial<DailyNewspaper> {
  const trimmed = text.trim();
  const jsonText = trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;
  return JSON.parse(jsonText) as Partial<DailyNewspaper>;
}

function extractResponseText(payload: {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
}) {
  if (payload.output_text) return payload.output_text;

  return (
    payload.output
      ?.flatMap((item) => item.content || [])
      .map((content) => content.text)
      .filter(Boolean)
      .join("\n")
      .trim() || ""
  );
}

function cleanList(value: unknown, fallback: string[], limit: number) {
  const source = Array.isArray(value) && value.length ? value : fallback;
  return source.map((item) => cleanLong(String(item || ""), 260)).filter(Boolean).slice(0, limit);
}

function dailyNewspaperBlocks(newspaper: DailyNewspaper): LarkReportBlock[] {
  return [
    { type: "heading1", text: newspaper.title },
    { type: "text", text: newspaper.subtitle },
    { type: "divider" },
    { type: "heading2", text: "Front Page" },
    { type: "text", text: newspaper.topLine },
    {
      type: "table",
      rows: [
        ["Metric", "Today", "Why it matters"],
        ...newspaper.keyNumbers.map((item) => [item.metric, item.value, item.note]),
      ],
    },
    { type: "heading2", text: "Key CRM Movement" },
    ...bulletBlocks(newspaper.crmMovements, "No meaningful CRM movement worth escalating today."),
    { type: "heading2", text: "Client Emails Worth Reading" },
    ...bulletBlocks(newspaper.clientEmails, "No meaningful client emails worth escalating today."),
    { type: "heading2", text: "Calls Today" },
    ...bulletBlocks(newspaper.calls, "No important call outcomes captured today."),
    { type: "heading2", text: "Team Chat Watchlist" },
    ...bulletBlocks(newspaper.teamNotes, "No team-chat items need CEO attention today."),
    { type: "heading2", text: "Editor's Note" },
    { type: "text", text: newspaper.executiveNote },
  ];
}

function bulletBlocks(items: string[], emptyText: string): LarkReportBlock[] {
  const source = items.length ? items : [emptyText];
  return source.map((text) => ({ type: "text", text }));
}

function dailyNewspaperParagraphs(newspaper: DailyNewspaper) {
  return dailyNewspaperPlainText(newspaper).split("\n").filter(Boolean);
}

function dailyNewspaperPlainText(newspaper: DailyNewspaper) {
  return [
    newspaper.title,
    newspaper.subtitle,
    "",
    "Front Page",
    newspaper.topLine,
    "",
    "Key Numbers",
    ...newspaper.keyNumbers.map((item) => `${item.metric}: ${item.value} - ${item.note}`),
    "",
    "Key CRM Movement",
    ...prefixLines(newspaper.crmMovements),
    "",
    "Client Emails Worth Reading",
    ...prefixLines(newspaper.clientEmails),
    "",
    "Calls Today",
    ...prefixLines(newspaper.calls),
    "",
    "Team Chat Watchlist",
    ...prefixLines(newspaper.teamNotes),
    "",
    "Editor's Note",
    newspaper.executiveNote,
  ].join("\n");
}

function prefixLines(items: string[]) {
  return items.length ? items.map((item) => `- ${item}`) : ["- None."];
}

function formatChangeLine(change: SalesMemoryChange) {
  const before = clean(change.before || "blank");
  const after = clean(change.after || "blank");
  return `${change.account}: ${fieldLabel(change.field)} moved from ${before} to ${after}.`;
}

function formatEmailNoteLine(note: SalesContextNote) {
  const subject = extractLine(note.note, "Email received") || "No subject";
  const from = extractLine(note.note, "From") || "unknown sender";
  const matched = note.account ? `Matched to ${note.account}.` : "No CRM match yet.";
  const preview = previewFromNote(note.note);
  return `${subject} from ${from}. ${matched}${preview ? ` ${preview}` : ""}`;
}

function formatCallLine(deal: SalesDeal) {
  const outcome = [
    deal.qualification && deal.qualification !== "5" ? deal.qualification : "",
    deal.callStage && deal.callStage !== "5" ? deal.callStage : "",
    deal.nextStepsStatus && deal.nextStepsStatus !== "5" ? deal.nextStepsStatus : "",
    deal.finalVerdict && deal.finalVerdict !== "5" ? deal.finalVerdict : "",
  ]
    .filter(Boolean)
    .join(" / ");
  const notes = clean(deal.salesCallNotes || deal.agentNotes || deal.nextStep || deal.lookingFor || "");
  return `${deal.account}: ${outcome || "no outcome entered"}${notes ? ` - ${notes}` : ""}`;
}

function formatPassiveNoteLine(note: SalesContextNote) {
  const account = note.account ? `${note.account}: ` : "";
  return `${account}${clean(note.note || note.rawText)}`;
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

function cleanLong(value: string, limit: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, Math.max(limit - 3, 0))}...` : normalized;
}
