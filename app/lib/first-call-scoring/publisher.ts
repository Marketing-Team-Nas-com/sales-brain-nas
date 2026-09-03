import { sendLarkPostReport, type LarkPostElement } from "../lark";
import { createDealUpdate, type SalesDeal } from "../monday";
import { overallScore, type ChecklistMark, type FirstCallScore } from "./types";

export const QA_MARKER = "[First Call QA — AI Scoring]";
const label: Record<ChecklistMark, string> = { yes: "✅", no: "❌", partial: "⚠️", unclear: "❔" };
const checklistLabels: Array<[keyof FirstCallScore["checklist"], string]> = [
  ["painIdentified", "Pain identified"], ["painDeeplyExplored", "Pain deeply explored"], ["fitEstablished", "Fit established"],
  ["decisionMaker", "Decision maker"], ["decisionProcess", "Decision process"], ["pricing", "Pricing discussed"],
  ["relevantWorkflow", "Relevant workflow identified"], ["proposalAgreed", "Proposal agreed"], ["exactFollowUpTime", "Exact follow-up time"],
  ["proposalReviewCallBooked", "Proposal review call booked"],
];

function t(text: string, bold = false): LarkPostElement { return { tag: "text", text, ...(bold ? { style: ["bold"] } : {}) }; }
function a(text: string, href: string): LarkPostElement { return { tag: "a", text, href }; }
const heading = (text: string): LarkPostElement[] => [t(text, true)];
const line = (text = ""): LarkPostElement[] => [t(text)];

export function hasMatchingQaUpdate(deal: SalesDeal, fingerprint: string) {
  return Boolean(deal.mondayUpdates?.some((update) => update.body.includes(QA_MARKER) && update.body.includes(fingerprint)));
}

export async function publishScore({ deal, score, chatId }: { deal: SalesDeal; score: FirstCallScore; chatId: string }) {
  const overall = overallScore(score).toFixed(1);
  const links: LarkPostElement[] = [t("Links: ", true)];
  if (deal.website) links.push(a("Website", deal.website), t("  |  "));
  links.push(a("Monday", deal.mondayUrl));
  if (deal.geminiNotesUrl) links.push(t("  |  "), a("Gemini Notes", deal.geminiNotesUrl));
  const content: LarkPostElement[][] = [
    heading(`📞 ${deal.account}`), [t("Sales Agent: ", true), t(deal.owner || "Unknown")], [t("First Meeting: ", true), t(deal.firstMeetingDate)], links,
    line(), heading(`Call Score: ${overall}/10`), line(`Discovery ${score.discovery}  |  Qualification ${score.qualification}  |  Pitch ${score.pitch}  |  Buying Process ${score.buyingProcess}  |  Next-Step Execution ${score.nextStepExecution}`),
    line(), heading("Verdict"), line(`${score.verdict} call`), line(), heading("ICP Fit"), line(score.icpFit),
    line(), heading("Best Workflow Identified"), line(score.bestWorkflowIdentified), line(), heading("Primary Objection"), line(score.primaryObjection),
    line(), heading("Mandatory Checklist"), ...checklistLabels.map(([key, text]) => line(`${label[score.checklist[key]]} ${text}`)),
    line(), heading("What Went Well"), ...score.whatWentWell.map((item) => line(`• ${item}`)),
    line(), heading("What Was Missed"), ...score.whatWasMissed.map((item) => line(`• ${item}`)),
    line(), heading("Biggest Coaching Point"), line(score.biggestCoachingPoint),
    line(), heading("Product / Accuracy Risks"), line(score.productAccuracyRisks),
    line(), heading("Recommended Next Step"), line(score.recommendedNextStep),
  ];
  await sendLarkPostReport({ chatId, content });
  await createDealUpdate({ itemId: deal.id, body: `${QA_MARKER}\n\nCall Score: ${overall}/10\nDiscovery ${score.discovery} | Qualification ${score.qualification} | Pitch ${score.pitch} | Buying Process ${score.buyingProcess} | Next-Step Execution ${score.nextStepExecution}\n\nVerdict: ${score.verdict}\nICP Fit: ${score.icpFit}\n\nBiggest Coaching Point:\n${score.biggestCoachingPoint}\n\nRecommended Next Step:\n${score.recommendedNextStep}\n\nScoring source: First-call Gemini notes only. Later pipeline activity and outcomes were not used.` });
}

export async function publishAlert({ deal, chatId, kind, mention }: { deal: SalesDeal; chatId: string; kind: "missing" | "access"; mention?: LarkPostElement }) {
  const reason = kind === "missing" ? "No Gemini notes document is linked to this completed first-meeting record." : "The Gemini notes document is linked, but the scorer does not have permission to read it.";
  const action = kind === "missing" ? "Please add the first-call Gemini notes link to the Monday item." : "Please update the Gemini document access so the scoring system can read it.";
  const agent: LarkPostElement = mention || t(deal.owner || "Unknown");
  await sendLarkPostReport({ chatId, content: [heading(`⚠️ Call Not Scored — ${deal.account}`), [t("Sales Agent: ", true), agent], [t("First Meeting: ", true), t(deal.firstMeetingDate)], [t("Links: ", true), a("Monday", deal.mondayUrl), ...(deal.geminiNotesUrl ? [t("  |  "), a("Gemini Notes", deal.geminiNotesUrl)] : [])], line(), heading("Reason"), line(reason), line(), heading("Action Required"), [t(`${action} Once available, the call will be scored automatically. `), agent]] });
  await createDealUpdate({ itemId: deal.id, body: `${QA_MARKER}\n\nCALL NOT SCORED\n\nReason: ${reason}\n\nAction required: ${action} Once available, this call will be scored automatically.` });
}
