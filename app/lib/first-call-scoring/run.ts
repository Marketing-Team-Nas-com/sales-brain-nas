import { getBoardSnapshot } from "../monday";
import type { LarkPostElement } from "../lark";
import { firstCallEligibility } from "./eligibility";
import { readFirstCallNotes } from "./notes";
import { hasMatchingQaUpdate, publishAlert, publishScore } from "./publisher";
import { scoreFirstCall } from "./scorer";

function ownerMention(owner: string): LarkPostElement | undefined {
  const map = JSON.parse(process.env.FIRST_CALL_SCORING_LARK_OWNER_IDS || "{}") as Record<string, string>;
  const matched = Object.entries(map).find(([name]) => owner.toLowerCase().includes(name.toLowerCase()));
  return matched ? { tag: "at", user_id: matched[1], user_name: matched[0] } : undefined;
}

export async function runFirstCallScoring() {
  const boardId = process.env.MONDAY_SALES_BOARD_ID || "5029402147";
  const chatId = process.env.FIRST_CALL_SCORING_LARK_CHAT_ID;
  if (!chatId) throw new Error("FIRST_CALL_SCORING_LARK_CHAT_ID is not configured.");
  const { deals } = await getBoardSnapshot(boardId);
  const result = { scored: [] as string[], alerted: [] as string[], skipped: [] as string[], errors: [] as Array<{ id: string; error: string }> };
  for (const deal of deals) {
    const eligibility = firstCallEligibility(deal);
    if (!eligibility.eligible) continue;
    try {
      const notes = await readFirstCallNotes(deal);
      if (notes.status === "missing") {
        if (hasMatchingQaUpdate(deal, "No Gemini notes document is linked")) { result.skipped.push(deal.id); continue; }
        await publishAlert({ deal, chatId, kind: "missing", mention: ownerMention(deal.owner) }); result.alerted.push(deal.id); continue;
      }
      if (notes.status === "inaccessible") {
        if (hasMatchingQaUpdate(deal, "does not have permission to read it")) { result.skipped.push(deal.id); continue; }
        await publishAlert({ deal, chatId, kind: "access", mention: ownerMention(deal.owner) }); result.alerted.push(deal.id); continue;
      }
      if (deal.mondayUpdates?.some((update) => update.body.includes("[First Call QA — AI Scoring]") && update.body.includes("Call Score:"))) { result.skipped.push(deal.id); continue; }
      const score = await scoreFirstCall(notes.text);
      await publishScore({ deal, score, chatId }); result.scored.push(deal.id);
    } catch (error) { result.errors.push({ id: deal.id, error: error instanceof Error ? error.message : String(error) }); }
  }
  return result;
}
