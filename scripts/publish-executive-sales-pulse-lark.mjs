import {
  appendLarkReportBlocks,
  createLarkDocument,
  grantLarkDocumentPermission,
  sendLarkTextReport,
} from "../app/lib/lark.ts";
import {
  buildExecutiveSalesPulseReport,
} from "../app/lib/executive-sales-pulse-preview.ts";
import {
  buildExecutiveSalesPulseLarkBlocks,
} from "../app/lib/executive-sales-pulse-lark.ts";
import {
  executiveSalesPulseFixture,
  fixtureGeneratedAt,
} from "../prototype/executive-sales-pulse-fixtures.ts";

const chatId = process.argv[2];
if (!chatId?.startsWith("oc_")) {
  throw new Error("Pass the exact Lark chat ID as the first argument.");
}

const report = buildExecutiveSalesPulseReport({
  fixture: executiveSalesPulseFixture,
  generatedAt: fixtureGeneratedAt,
});
const document = await createLarkDocument({
  title: "Executive Sales Pulse — Fixture Test",
});

await appendLarkReportBlocks({
  documentId: document.documentId,
  blocks: buildExecutiveSalesPulseLarkBlocks(report),
});
await grantLarkDocumentPermission({
  token: document.documentId,
  memberType: "openchat",
  memberId: chatId,
  permission: "view",
});
await sendLarkTextReport({
  chatId,
  text: `Fixture test: Executive Sales Pulse\n${document.url}`,
});

console.log(
  JSON.stringify({
    ok: true,
    documentId: document.documentId,
    url: document.url,
    chatId,
  }),
);
