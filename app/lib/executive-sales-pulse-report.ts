import {
  appendLarkReportBlocks,
  createLarkDocument,
  grantLarkDocumentPermission,
  sendLarkTextReport,
} from "./lark.ts";
import { getBoardActivityChanges, getBoardSnapshot } from "./monday.ts";
import { buildExecutiveSalesPulseLarkBlocks } from "./executive-sales-pulse-lark.ts";
import { executiveSalesPulseFromMonday } from "./executive-sales-pulse-monday.ts";
import {
  buildExecutiveSalesPulseReport,
  EXECUTIVE_SALES_BOARD_ID,
  reportingWindowFor,
} from "./executive-sales-pulse-preview.ts";

export const DEFAULT_REPORT_EDITORS = [
  "roge@nas.io",
  "alex@nas.io",
  "lesha@nasdaily.com",
];

export async function createExecutiveSalesPulseReport({
  generatedAt = new Date().toISOString(),
  chatId,
  sendToChat = true,
}: {
  generatedAt?: string;
  chatId?: string;
  sendToChat?: boolean;
} = {}) {
  const window = reportingWindowFor(generatedAt);
  const targetChatId =
    chatId ||
    process.env.LARK_SALES_PULSE_CHAT_ID ||
    process.env.LARK_SALES_REPORT_CHAT_ID;
  if (sendToChat && !targetChatId) {
    throw new Error("LARK_SALES_PULSE_CHAT_ID is not configured.");
  }

  const [{ deals }, activityChanges] = await Promise.all([
    getBoardSnapshot(EXECUTIVE_SALES_BOARD_ID),
    getBoardActivityChanges({
      boardId: EXECUTIVE_SALES_BOARD_ID,
      from: window.start,
      to: window.end,
    }),
  ]);
  const fixture = executiveSalesPulseFromMonday({ deals, window, activityChanges });
  const report = buildExecutiveSalesPulseReport({ fixture, generatedAt, window });
  const document = await createLarkDocument({
    title: `Executive Sales Pulse — ${window.cadence}`,
  });
  await appendLarkReportBlocks({
    documentId: document.documentId,
    blocks: buildExecutiveSalesPulseLarkBlocks(report),
  });
  await shareReportDocument(document.documentId, targetChatId);

  if (sendToChat && targetChatId) {
    await sendLarkTextReport({
      chatId: targetChatId,
      text: `Executive Sales Pulse\nReporting window: ${window.start} through ${window.end} SGT\n${document.url}`,
    });
  }

  return { ok: true, document, window, report };
}

export async function shareReportDocument(
  documentId: string,
  chatId?: string,
) {
  if (chatId) {
    await grantLarkDocumentPermission({
      token: documentId,
      memberType: "openchat",
      memberId: chatId,
      permission: "view",
    });
  }
  const configured = process.env.LARK_SALES_REPORT_EDITOR_EMAILS;
  const editors = configured
    ? configured.split(",").map((value) => value.trim()).filter(Boolean)
    : DEFAULT_REPORT_EDITORS;
  for (const email of [...new Set(editors)]) {
    await grantLarkDocumentPermission({
      token: documentId,
      memberType: "email",
      memberId: email,
      permission: "edit",
    });
  }
}
