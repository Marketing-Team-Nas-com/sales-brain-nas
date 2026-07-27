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
  sendToChat = false,
  createLarkDoc: shouldCreateLarkDoc = false,
  previewOnly = false,
}: {
  chatId?: string;
  sendToChat?: boolean;
  createLarkDoc?: boolean;
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
  const html = dailyNewspaperHtml(newspaper);

  if (previewOnly || !shouldCreateLarkDoc) {
    return {
      ok: true,
      date: today,
      previewOnly: true,
      document: null,
      writeMode: "draft-html",
      writeError: "",
      reportPreview: plainText.slice(0, 4000),
      html,
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
    html,
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
                  "Only include key updates a CEO or sales leader would care about.",
                  "Do not report operational volume such as total CRM changes, total notes captured, or noisy field edits.",
                  "Remove test emails, noise, duplicate rows, and low-value system movements.",
                  "Important means: a deal advanced, a deal regressed, a qualified or high-budget call happened, a client replied with meaningful buying signal, a risk/blocker appeared, or a team note creates a follow-up action.",
                  "Team-chat items are important when they mention a client asking for another/second follow-up call, a demo, proof-of-value, who should join a meeting, whether Nuseir should join, or a team member asking for ownership/next-step guidance.",
                  "When team chat includes both a client signal and an internal decision question, summarize it as an action item with the company/client name and the decision needed.",
                  "If the day has many raw CRM changes but few meaningful changes, say only the meaningful changes.",
                  "The topLine should be one executive sentence, not a data dump.",
                  "keyNumbers should contain at most 3 metrics and only business metrics, such as sales-qualified calls, high-priority follow-ups, or important booked meetings. Never include 'CRM changes'.",
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
  const meaningfulCrm = facts.crmChanges.filter(isMeaningfulCrmMovement).slice(-5);
  const meaningfulEmails = facts.emails.filter(isMeaningfulEmail).slice(-4);
  const meaningfulCalls = facts.calls.filter(isMeaningfulCall).slice(0, 5);
  const meaningfulTeamNotes = facts.teamNotes.filter(isMeaningfulTeamNote).slice(-4);
  const topLineParts = [
    facts.counts.salesQualifiedCalls
      ? `${facts.counts.salesQualifiedCalls} call became sales qualified`
      : "",
    meaningfulCrm.length ? `${meaningfulCrm.length} meaningful CRM moves need attention` : "",
    meaningfulCalls.length ? `${meaningfulCalls.length} priority calls are worth reviewing` : "",
  ].filter(Boolean);

  return {
    title: `The Sales Brain Evening Edition - ${facts.friendlyDate}`,
    subtitle: "A tight end-of-day read on what moved, who replied, and what needs attention.",
    topLine: topLineParts.length
      ? `${topLineParts.join("; ")}.`
      : "No major sales movement needs escalation today.",
    keyNumbers: [
      {
        metric: "Sales qualified",
        value: String(facts.counts.salesQualifiedCalls),
        note: "From today's happened calls",
      },
      {
        metric: "Priority calls",
        value: String(meaningfulCalls.length),
        note: "Worth reading, not every call",
      },
      {
        metric: "Follow-up watchlist",
        value: String(meaningfulTeamNotes.length),
        note: "Team notes with action signal",
      },
    ],
    crmMovements: meaningfulCrm,
    clientEmails: meaningfulEmails,
    calls: meaningfulCalls,
    teamNotes: meaningfulTeamNotes,
    executiveNote: "Keep the brief focused on deal movement and follow-up risk; raw CRM activity can stay in the CRM.",
  };
}

function normalizeDailyNewspaper(value: Partial<DailyNewspaper>, fallback: DailyNewspaper): DailyNewspaper {
  const normalizedKeyNumbers = Array.isArray(value.keyNumbers)
    ? value.keyNumbers
        .filter((item) => !/\bcrm changes?\b/i.test(String(item.metric || "")))
        .slice(0, 3)
        .map((item) => ({
          metric: cleanLong(String(item.metric || ""), 60),
          value: cleanLong(String(item.value || ""), 40),
          note: cleanLong(String(item.note || ""), 120),
        }))
    : [];

  return {
    title: cleanLong(value.title || fallback.title, 120),
    subtitle: cleanLong(value.subtitle || fallback.subtitle, 220),
    topLine: cleanLong(value.topLine || fallback.topLine, 420),
    keyNumbers: normalizedKeyNumbers.length ? normalizedKeyNumbers : fallback.keyNumbers,
    crmMovements: cleanList(value.crmMovements, fallback.crmMovements, 6).filter(isMeaningfulCrmMovement),
    clientEmails: cleanList(value.clientEmails, fallback.clientEmails, 5).filter(isMeaningfulEmail),
    calls: cleanList(value.calls, fallback.calls, 6).filter(isMeaningfulCall),
    teamNotes: cleanList(value.teamNotes, fallback.teamNotes, 5).filter(isMeaningfulTeamNote),
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

function isMeaningfulCrmMovement(line: string) {
  const normalized = line.toLowerCase();

  if (/\bmoved from 5 to blank\b|\bremoved moved\b|\bcreated moved from blank to 5\b/.test(normalized)) {
    return false;
  }

  return /\b(sales qualified|agreement|signed|lost|not fit|booked|proposal|budget|hot|followed|second call|confirmed|completed|no show|cancelled|reschedule)\b/.test(
    normalized,
  );
}

function isMeaningfulCall(line: string) {
  const normalized = line.toLowerCase();

  if (/\bno outcome entered\b/.test(normalized)) return false;

  return /\b(sales qualified|agreement|signed|proposal|fit|1m|\$1m|high confidence|medium confidence|deck|budget|decision maker|follow-up|follow up|risk|blocked)\b/.test(
    normalized,
  );
}

function isMeaningfulEmail(line: string) {
  const normalized = line.toLowerCase();

  if (/\b(test|hi$|werf|no subject)\b/.test(normalized)) return false;

  return /\b(interested|proposal|agreement|contract|signed|budget|meeting|call|question|concern|follow|reply|intro|deck|pricing|yes|ready|approved)\b/.test(
    normalized,
  );
}

function isMeaningfulTeamNote(line: string) {
  const normalized = line.toLowerCase();

  return /\b(booked|do not email|follow|follow-up|second|2nd|another call|proposal|qualified|not fit|risk|blocked|budget|meeting|call|client|deal|nuseir|join|involve|demo|proof[- ]of[- ]value|working session|reply|send|who should|shall i|should i)\b/.test(
    normalized,
  );
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

function dailyNewspaperHtml(newspaper: DailyNewspaper) {
  const section = (title: string, items: string[]) => `
    <section class="section">
      <h2>${escapeHtml(title)}</h2>
      ${
        items.length
          ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
          : `<p class="muted">No key updates.</p>`
      }
    </section>`;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(newspaper.title)}</title>
    <style>
      body {
        margin: 0;
        background: #f4f0e8;
        color: #191919;
        font-family: Georgia, "Times New Roman", serif;
      }
      .paper {
        max-width: 980px;
        margin: 28px auto;
        background: #fffdf8;
        border: 1px solid #d8d0c2;
        box-shadow: 0 18px 45px rgba(30, 24, 16, 0.14);
        padding: 38px 44px 44px;
      }
      .masthead {
        border-bottom: 4px double #1f1f1f;
        text-align: center;
        padding-bottom: 18px;
        margin-bottom: 22px;
      }
      h1 {
        font-size: clamp(34px, 5vw, 58px);
        line-height: 0.95;
        margin: 0 0 10px;
        letter-spacing: 0;
      }
      .subtitle {
        font-family: Arial, sans-serif;
        font-size: 15px;
        margin: 0;
        color: #555;
      }
      .topline {
        font-size: 24px;
        line-height: 1.25;
        border-bottom: 1px solid #d8d0c2;
        padding-bottom: 20px;
        margin: 0 0 22px;
      }
      .metrics {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        border-top: 1px solid #1f1f1f;
        border-bottom: 1px solid #1f1f1f;
        margin: 18px 0 28px;
      }
      .metric {
        padding: 14px 12px;
        border-right: 1px solid #d8d0c2;
        font-family: Arial, sans-serif;
      }
      .metric:last-child { border-right: 0; }
      .metric strong {
        display: block;
        font-size: 28px;
        margin-bottom: 3px;
      }
      .metric span {
        display: block;
        font-size: 13px;
        color: #555;
      }
      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px 34px;
      }
      .section {
        border-top: 2px solid #1f1f1f;
        padding-top: 10px;
      }
      h2 {
        font-family: Arial, sans-serif;
        font-size: 15px;
        text-transform: uppercase;
        letter-spacing: 0;
        margin: 0 0 10px;
      }
      ul {
        margin: 0;
        padding-left: 18px;
      }
      li {
        font-size: 16px;
        line-height: 1.35;
        margin: 0 0 9px;
      }
      .editor {
        margin-top: 28px;
        border-top: 4px double #1f1f1f;
        padding-top: 14px;
        font-size: 19px;
        line-height: 1.35;
      }
      .muted {
        color: #666;
        font-family: Arial, sans-serif;
      }
      @media (max-width: 760px) {
        .paper { margin: 0; padding: 24px 18px; }
        .metrics, .grid { grid-template-columns: 1fr; }
        .metric { border-right: 0; border-bottom: 1px solid #d8d0c2; }
      }
    </style>
  </head>
  <body>
    <main class="paper">
      <header class="masthead">
        <h1>${escapeHtml(newspaper.title)}</h1>
        <p class="subtitle">${escapeHtml(newspaper.subtitle)}</p>
      </header>
      <p class="topline">${escapeHtml(newspaper.topLine)}</p>
      <div class="metrics">
        ${newspaper.keyNumbers
          .map(
            (item) => `<div class="metric"><strong>${escapeHtml(item.value)}</strong>${escapeHtml(
              item.metric,
            )}<span>${escapeHtml(item.note)}</span></div>`,
          )
          .join("")}
      </div>
      <div class="grid">
        ${section("Key CRM Movement", newspaper.crmMovements)}
        ${section("Client Emails Worth Reading", newspaper.clientEmails)}
        ${section("Calls Today", newspaper.calls)}
        ${section("Team Chat Watchlist", newspaper.teamNotes)}
      </div>
      <section class="editor">
        <h2>Editor's Note</h2>
        ${escapeHtml(newspaper.executiveNote)}
      </section>
    </main>
  </body>
</html>`;
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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
