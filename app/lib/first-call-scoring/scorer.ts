import type { FirstCallScore } from "./types";

const SYSTEM_PROMPT = `You score Nas Force FIRST sales meetings from Gemini notes.
Use only what the salesperson actually said and handled in this original call. Do not use Monday stage, later qualification, later follow-up, or eventual progression.
First extract facts, then score salesperson execution: how well they uncovered, deepened, connected, and advanced the opportunity.
Score five categories as whole numbers from 1 to 10: Discovery, Qualification, Pitch, Buying Process, Next-Step Execution.
Missing information limits a category only when it creates a meaningful commercial gap; do not automatically make a major deduction.
A proposal review call is preferred. A stakeholder follow-up is also strong when action, owner, and timing are clear.
Verdict must follow the arithmetic average: below 4.5 Weak; 4.5-6.4 Mixed; 6.5-7.9 Good; 8.0-10 Strong.
ICP Fit is contextual, not part of the score. Never confuse the salesperson's qualification decision with call quality.
Return concise, evidence-grounded coaching. Do not invent evidence.`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["discovery", "qualification", "pitch", "buyingProcess", "nextStepExecution", "verdict", "icpFit", "bestWorkflowIdentified", "primaryObjection", "checklist", "whatWentWell", "whatWasMissed", "biggestCoachingPoint", "productAccuracyRisks", "recommendedNextStep"],
  properties: {
    discovery: { type: "integer", minimum: 1, maximum: 10 }, qualification: { type: "integer", minimum: 1, maximum: 10 },
    pitch: { type: "integer", minimum: 1, maximum: 10 }, buyingProcess: { type: "integer", minimum: 1, maximum: 10 }, nextStepExecution: { type: "integer", minimum: 1, maximum: 10 },
    verdict: { type: "string", enum: ["Weak", "Mixed", "Good", "Strong"] },
    icpFit: { type: "string", enum: ["Strong Fit", "Possible Fit", "Weak Fit", "Not Enough Information"] },
    bestWorkflowIdentified: { type: "string" }, primaryObjection: { type: "string" },
    checklist: { type: "object", additionalProperties: false, required: ["painIdentified", "painDeeplyExplored", "fitEstablished", "decisionMaker", "decisionProcess", "pricing", "relevantWorkflow", "proposalAgreed", "exactFollowUpTime", "proposalReviewCallBooked"], properties: Object.fromEntries(["painIdentified", "painDeeplyExplored", "fitEstablished", "decisionMaker", "decisionProcess", "pricing", "relevantWorkflow", "proposalAgreed", "exactFollowUpTime", "proposalReviewCallBooked"].map((key) => [key, { type: "string", enum: ["yes", "no", "partial", "unclear"] }])) },
    whatWentWell: { type: "array", items: { type: "string" }, maxItems: 3 }, whatWasMissed: { type: "array", items: { type: "string" }, maxItems: 3 },
    biggestCoachingPoint: { type: "string" }, productAccuracyRisks: { type: "string" }, recommendedNextStep: { type: "string" },
  },
};

export async function scoreFirstCall(notes: string): Promise<FirstCallScore> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.FIRST_CALL_SCORING_MODEL || process.env.OPENAI_MODEL || "gpt-5.6-terra",
      reasoning: { effort: process.env.FIRST_CALL_SCORING_REASONING_EFFORT || process.env.OPENAI_REASONING_EFFORT || "medium" },
      input: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: `FIRST-CALL GEMINI NOTES:\n${notes}` }],
      text: { format: { type: "json_schema", name: "first_call_score", strict: true, schema } },
    }),
  });
  const payload = await response.json() as { output_text?: string; error?: { message?: string }; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (!response.ok) throw new Error(payload.error?.message || "OpenAI scoring request failed.");
  const text = payload.output_text || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!text) throw new Error("OpenAI returned no structured score.");
  const score = JSON.parse(text) as FirstCallScore;
  const average = (score.discovery + score.qualification + score.pitch + score.buyingProcess + score.nextStepExecution) / 5;
  score.verdict = average < 4.5 ? "Weak" : average < 6.5 ? "Mixed" : average < 8 ? "Good" : "Strong";
  return score;
}

export { SYSTEM_PROMPT as FIRST_CALL_SCORING_PROMPT };
