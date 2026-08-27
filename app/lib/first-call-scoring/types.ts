export type ChecklistMark = "yes" | "no" | "partial" | "unclear";

export type FirstCallScore = {
  discovery: number;
  qualification: number;
  pitch: number;
  buyingProcess: number;
  nextStepExecution: number;
  verdict: "Weak" | "Mixed" | "Good" | "Strong";
  icpFit: "Strong Fit" | "Possible Fit" | "Weak Fit" | "Not Enough Information";
  bestWorkflowIdentified: string;
  primaryObjection: string;
  checklist: {
    painIdentified: ChecklistMark;
    painDeeplyExplored: ChecklistMark;
    fitEstablished: ChecklistMark;
    decisionMaker: ChecklistMark;
    decisionProcess: ChecklistMark;
    pricing: ChecklistMark;
    relevantWorkflow: ChecklistMark;
    proposalAgreed: ChecklistMark;
    exactFollowUpTime: ChecklistMark;
    proposalReviewCallBooked: ChecklistMark;
  };
  whatWentWell: string[];
  whatWasMissed: string[];
  biggestCoachingPoint: string;
  productAccuracyRisks: string;
  recommendedNextStep: string;
};

export function overallScore(score: FirstCallScore) {
  return (
    score.discovery +
    score.qualification +
    score.pitch +
    score.buyingProcess +
    score.nextStepExecution
  ) / 5;
}
