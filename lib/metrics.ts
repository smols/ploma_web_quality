import { groupPairs, groupReviewState } from "@/lib/session";
import type { ReviewSession } from "@/lib/types";

export interface CandidateMetrics {
  candidateGroups: number;
  candidatePairs: number;
  reviewedPairs: number;
  same: number;
  different: number;
  uncertain: number;
  pendingPairs: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  accuracy: number | null;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
  aiLabeledPairs: number;
  evaluatedPairs: number;
  coverage: number;
  acceptedGroups: number;
  splitGroups: number;
  uncertainGroups: number;
  pendingGroups: number;
  f1Message: string;
}

export function calculateCandidateMetrics(session: ReviewSession): CandidateMetrics {
  const pairs = Object.values(session.judgments);
  const same = pairs.filter((pair) => pair.humanLabel === "same").length;
  const different = pairs.filter((pair) => pair.humanLabel === "different").length;
  const uncertain = pairs.filter((pair) => pair.humanLabel === "uncertain").length;
  const reviewedPairs = same + different + uncertain;
  const scored = same + different;
  const groupStates = session.groups.map((group) => groupReviewState(session, group));
  const predictions = new Map<string, "same" | "different" | null>();
  for (const group of session.groups) {
    if (!group.aiLabel) continue;
    for (const pair of groupPairs(group)) {
      if (!predictions.has(pair.key)) {
        predictions.set(pair.key, group.aiLabel);
      } else if (predictions.get(pair.key) !== group.aiLabel) {
        predictions.set(pair.key, null);
      }
    }
  }
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;
  let evaluatedPairs = 0;
  for (const [pairKey, aiLabel] of predictions) {
    if (!aiLabel) continue;
    const humanLabel = session.judgments[pairKey]?.humanLabel;
    if (humanLabel !== "same" && humanLabel !== "different") continue;
    evaluatedPairs += 1;
    if (aiLabel === "same" && humanLabel === "same") truePositive += 1;
    else if (aiLabel === "same" && humanLabel === "different") falsePositive += 1;
    else if (aiLabel === "different" && humanLabel === "same") falseNegative += 1;
    else trueNegative += 1;
  }
  const hasAiPredictions = [...predictions.values()].some(Boolean);
  const precision = hasAiPredictions
    ? (truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : null)
    : (scored ? same / scored : null);
  const recall = hasAiPredictions
    ? (truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : null)
    : null;
  const f1Denominator = 2 * truePositive + falsePositive + falseNegative;
  const f1 = hasAiPredictions && f1Denominator ? (2 * truePositive) / f1Denominator : null;
  const accuracy = evaluatedPairs
    ? (truePositive + trueNegative) / evaluatedPairs
    : null;
  return {
    candidateGroups: session.groups.length,
    candidatePairs: pairs.length,
    reviewedPairs,
    same,
    different,
    uncertain,
    pendingPairs: pairs.length - reviewedPairs,
    precision,
    recall,
    f1,
    accuracy,
    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,
    aiLabeledPairs: [...predictions.values()].filter(Boolean).length,
    evaluatedPairs,
    coverage: pairs.length ? reviewedPairs / pairs.length : 0,
    acceptedGroups: groupStates.filter((state) => state === "accepted").length,
    splitGroups: groupStates.filter((state) => state === "split").length,
    uncertainGroups: groupStates.filter((state) => state === "uncertain").length,
    pendingGroups: groupStates.filter((state) => state === "unreviewed" || state === "partial").length,
    f1Message: hasAiPredictions
      ? "F1 рассчитан по парам, размеченным человеком как «один сюжет» или «разные сюжеты»; неопределённые и неразмеченные пары исключены."
      : "В этой выгрузке нет AI-меток same/different. Для F1 нужна оценочная выборка с обоими AI-предсказаниями.",
  };
}

export function totalGroupPairs(session: ReviewSession): number {
  return session.groups.reduce((sum, group) => sum + groupPairs(group).length, 0);
}
