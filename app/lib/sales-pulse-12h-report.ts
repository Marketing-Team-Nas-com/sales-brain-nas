import {
  appendLarkReportBlocks,
  createLarkDocument,
  sendLarkPostReport,
  type LarkPostElement,
} from "./lark.ts";
import { getBoardActivityChanges, getBoardSnapshot } from "./monday.ts";
import { EXECUTIVE_SALES_BOARD_ID } from "./executive-sales-pulse-preview.ts";
import { shareReportDocument } from "./executive-sales-pulse-report.ts";

const NEXT_STEPS = ["Proposal Stage", "Proposal Done"] as const;
const VERDICTS = [
  "Agreement Stage",
  "Confirmed (Verbal)",
  "2nd call with Nuseir",
  "Signed",
  "Lost / Gone Cold",
] as const;

export type PulseWindow = { start: string; end: string };

export function pulseWindowFor(scheduledAt: string): PulseWindow {
  const end = new Date(scheduledAt);
  const parts = sgtParts(end);
  if (parts.weekday === "sunday" || ![9, 21].includes(parts.hour)) {
    throw new Error("12-hour Sales Pulse runs at 09:00 and 21:00 SGT, Monday through Saturday.");
  }
  const hours = parts.weekday === "monday" && parts.hour === 9 ? 36 : 12;
  return {
    start: isoWithSgtOffset(new Date(end.getTime() - hours * 60 * 60 * 1000)),
    end: isoWithSgtOffset(end),
  };
}

export async function create12HourSalesPulse({
  scheduledAt = new Date().toISOString(),
  chatId,
  sendToChat = true,
}: {
  scheduledAt?: string;
  chatId?: string;
  sendToChat?: boolean;
} = {}) {
  const window = pulseWindowFor(scheduledAt);
  const targetChatId =
    chatId ||
    process.env.LARK_SALES_PULSE_CHAT_ID ||
    process.env.LARK_SALES_REPORT_CHAT_ID;
  if (sendToChat && !targetChatId) {
    throw new Error("LARK_SALES_PULSE_CHAT_ID is not configured.");
  }
  const [{ deals }, changes] = await Promise.all([
    getBoardSnapshot(EXECUTIVE_SALES_BOARD_ID),
    getBoardActivityChanges({
      boardId: EXECUTIVE_SALES_BOARD_ID,
      from: window.start,
      to: window.end,
    }),
  ]);
  const names = new Map(deals.map((deal) => [deal.id, deal.account]));
  const grouped = Object.fromEntries(
    [...NEXT_STEPS, ...VERDICTS].map((stage) => [stage, [] as string[]]),
  ) as Record<(typeof NEXT_STEPS)[number] | (typeof VERDICTS)[number], string[]>;

  for (const change of changes) {
    const stage = movementStage(change.columnTitle, change.value);
    const company = names.get(change.itemId);
    if (stage && company && !grouped[stage].includes(company)) grouped[stage].push(company);
  }

  const overall = Object.fromEntries(
    [...NEXT_STEPS, ...VERDICTS].map((stage) => [
      stage,
      deals.filter((deal) =>
        stage === "Lost / Gone Cold"
          ? /^(Lost|Gone Cold)$/i.test(deal.finalVerdict)
          : stage === "Proposal Stage" || stage === "Proposal Done"
            ? deal.nextStepsStatus === stage
            : deal.finalVerdict === stage,
      ),
    ]),
  ) as Record<string, typeof deals>;
  const tracker = await createLarkDocument({ title: "Overall Sales Pipeline by Stage" });
  await appendLarkReportBlocks({
    documentId: tracker.documentId,
    blocks: [
      { type: "heading1", text: "Overall Sales Pipeline by Stage" },
      { type: "text", text: `Generated: ${formatSgt(scheduledAt)}` },
      ...[...NEXT_STEPS, ...VERDICTS].flatMap((stage) => [
        { type: "heading2" as const, text: `${stage} (${overall[stage].length})` },
        {
          type: "text" as const,
          text: overall[stage].length
            ? overall[stage].map((deal) => `• ${deal.account}`).join("\n")
            : "None",
        },
      ]),
    ],
  });
  await shareReportDocument(tracker.documentId, targetChatId);
  const content = buildPulsePost(window, grouped, tracker.url);
  if (sendToChat && targetChatId) {
    await sendLarkPostReport({ chatId: targetChatId, content });
  }
  return { ok: true, window, grouped, tracker, content };
}

function movementStage(column: string, value: string) {
  if (/^Next Steps$/i.test(column) && NEXT_STEPS.includes(value as never)) return value as (typeof NEXT_STEPS)[number];
  if (!/^Final Verdict$/i.test(column)) return null;
  if (/^(Lost|Gone Cold)$/i.test(value)) return "Lost / Gone Cold" as const;
  return VERDICTS.includes(value as never) ? value as (typeof VERDICTS)[number] : null;
}

function buildPulsePost(
  window: PulseWindow,
  grouped: Record<string, string[]>,
  trackerUrl: string,
): LarkPostElement[][] {
  const rows: LarkPostElement[][] = [
    [{ tag: "text", text: "SALES PULSE", style: ["bold"] }],
    [{ tag: "text", text: `Reporting window: ${formatPulseDateRange(window.start, window.end)} SGT` }],
    [],
    [{ tag: "text", text: "NEXT STEPS", style: ["bold", "underline"] }],
  ];
  for (const stage of NEXT_STEPS) rows.push(...stageRows(stage, grouped[stage]));
  rows.push([], [{ tag: "text", text: "FINAL VERDICT", style: ["bold", "underline"] }]);
  for (const stage of VERDICTS) {
    if (stage === "Lost / Gone Cold" && !grouped[stage].length) continue;
    rows.push(...stageRows(stage, grouped[stage]));
  }
  rows.push([], [
    { tag: "text", text: "📌 Overall pipeline by stage: ", style: ["bold"] },
    { tag: "a", text: "Open tracker", href: trackerUrl, style: ["bold"] },
  ]);
  return rows;
}

function stageRows(stage: string, companies: string[]): LarkPostElement[][] {
  return [
    [{ tag: "text", text: `• ${stage} (${companies.length})` }],
    ...companies.map((company) => [{ tag: "text" as const, text: `  • ${company}` }]),
  ];
}

function sgtParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Singapore", weekday: "long", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return { weekday: get("weekday").toLowerCase(), hour: Number(get("hour")) };
}

function isoWithSgtOffset(value: Date) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(value);
  const get = (type: string) => date.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+08:00`;
}

function formatSgt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Singapore", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(value)) + " SGT";
}

export function formatPulseDateRange(start: string, end: string) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const startLabel = formatter.format(new Date(start));
  const endLabel = formatter.format(new Date(end));
  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
}
