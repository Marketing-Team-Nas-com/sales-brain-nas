import {
  getBoardActivityChanges,
  getBoardSnapshot,
} from "../app/lib/monday.ts";
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
  executiveSalesPulseFromMonday,
} from "../app/lib/executive-sales-pulse-monday.ts";

const chatId = process.argv[2];
const editorEmail = process.argv[3];
if (!chatId?.startsWith("oc_")) {
  throw new Error("Pass the exact Lark chat ID as the first argument.");
}
if (!editorEmail?.includes("@")) {
  throw new Error("Pass the editor email as the second argument.");
}

const window = {
  cadence: "Custom",
  start: "2026-07-24T00:00:00+08:00",
  end: "2026-07-29T23:59:59+08:00",
};
const generatedAt = new Date().toISOString();
const [{ deals }, activityChanges] = await Promise.all([
  getBoardSnapshot("5029402147"),
  getBoardActivityChanges({
    boardId: "5029402147",
    from: window.start,
    to: window.end,
  }),
]);
const fixture = executiveSalesPulseFromMonday({
  deals,
  window,
  activityChanges,
});
const report = buildExecutiveSalesPulseReport({
  fixture,
  generatedAt,
  window,
});
const document = await createLarkDocument({
  title: "Executive Sales Pulse — Monday Data Test (24–29 Jul 2026)",
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
await grantLarkDocumentPermission({
  token: document.documentId,
  memberType: "email",
  memberId: editorEmail,
  permission: "edit",
});
await sendLarkTextReport({
  chatId,
  text: `LIVE MONDAY DATA TEST — READ ONLY\nExecutive Sales Pulse · 24–29 Jul 2026 SGT\n${document.url}`,
});

console.log(
  JSON.stringify({
    ok: true,
    documentId: document.documentId,
    url: document.url,
    chatId,
    editorEmail,
    sourceRecordCount: deals.length,
    newLeadCount: report.newLeads.length,
    salesQualifiedCount: report.salesQualifiedDeals.length,
    hotCount: report.hotOpportunities.length,
    questionnaireCount: report.salesQualifiedCalls.length,
    meaningfulUpdateCount: report.updates.length,
    activityChangeCount: activityChanges.length,
    agreementStageDetailsInWindow: report.agreementStageActivityDeals.length,
    confirmedVerbalDetailsInWindow: report.confirmedVerbalWindowDeals.length,
    signedDetailsInWindow: report.signedActivityDeals.length,
    hotDetailsInWindow: report.hotWindowDeals.length,
    lostGoneColdDetailsInWindow: report.lostGoneColdWindowDeals.length,
    newlySalesQualifiedInWindow: report.salesQualifiedWindowDeals.length,
    pipelineStatus: report.pipelineHealthPresentation.status,
    movingForwardCount: report.pipelineScorecard.movingForward,
    stalledCount: report.pipelineScorecard.stalled,
    atRiskCount: report.pipelineScorecard.atRisk,
    dataCompletenessPercentage:
      report.pipelineScorecard.dataCompletenessPercentage,
  }),
);
