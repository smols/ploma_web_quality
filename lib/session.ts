import type {
  ImportedCollection,
  PairJudgment,
  PairRef,
  ReviewGroup,
  ReviewSession,
} from "@/lib/types";

function newSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    return (token === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

export function makePairKey(itemKeyA: string, itemKeyB: string): string {
  const [first, second] = [itemKeyA, itemKeyB].sort();
  return `${first}||${second}`;
}

export function groupPairs(group: ReviewGroup): PairRef[] {
  const pairs: PairRef[] = [];
  for (let i = 0; i < group.memberKeys.length; i += 1) {
    for (let j = i + 1; j < group.memberKeys.length; j += 1) {
      const [itemKeyA, itemKeyB] = [group.memberKeys[i], group.memberKeys[j]].sort();
      pairs.push({ key: makePairKey(itemKeyA, itemKeyB), itemKeyA, itemKeyB });
    }
  }
  return pairs;
}

export function createReviewSession(
  imported: ImportedCollection,
  annotatorName: string,
): ReviewSession {
  const now = new Date().toISOString();
  const judgments: Record<string, PairJudgment> = {};
  for (const group of imported.groups) {
    for (const pair of groupPairs(group)) {
      judgments[pair.key] ??= {
        ...pair,
        humanLabel: null,
        note: "",
        updatedAt: null,
      };
    }
  }
  return {
    schemaVersion: 1,
    sessionId: newSessionId(),
    annotatorName: annotatorName.trim(),
    createdAt: now,
    updatedAt: now,
    source: imported.source,
    items: imported.items,
    groups: imported.groups,
    judgments,
  };
}

export function setPairLabel(
  session: ReviewSession,
  pairKey: string,
  humanLabel: PairJudgment["humanLabel"],
): ReviewSession {
  const current = session.judgments[pairKey];
  if (!current) return session;
  const now = new Date().toISOString();
  return {
    ...session,
    updatedAt: now,
    judgments: {
      ...session.judgments,
      [pairKey]: { ...current, humanLabel, updatedAt: now },
    },
  };
}

export function setGroupPairsLabel(
  session: ReviewSession,
  groupId: string,
  humanLabel: PairJudgment["humanLabel"],
): ReviewSession {
  const group = session.groups.find((candidate) => candidate.id === groupId);
  if (!group) return session;
  const now = new Date().toISOString();
  const judgments = { ...session.judgments };
  for (const pair of groupPairs(group)) {
    const previous = judgments[pair.key];
    if (previous) judgments[pair.key] = { ...previous, humanLabel, updatedAt: now };
  }
  return { ...session, updatedAt: now, judgments };
}

export type GroupReviewState = "unreviewed" | "accepted" | "split" | "uncertain" | "partial";

export function groupReviewState(session: ReviewSession, group: ReviewGroup): GroupReviewState {
  const pairs = groupPairs(group);
  const labels = pairs.map((pair) => session.judgments[pair.key]?.humanLabel ?? null);
  if (labels.every((label) => label === "same")) return "accepted";
  if (labels.every((label) => label === null)) return "unreviewed";
  if (labels.some((label) => label === null)) return "partial";
  if (labels.every((label) => label === "uncertain")) return "uncertain";
  if (labels.some((label) => label === "different")) return "split";
  return "uncertain";
}

export interface CandidateMetrics {
  candidateGroups: number;
  candidatePairs: number;
  reviewedPairs: number;
  samePairs: number;
  differentPairs: number;
  uncertainPairs: number;
  pendingPairs: number;
  candidatePrecision: number | null;
  reviewedPairCoverage: number;
  acceptedGroups: number;
  splitGroups: number;
  uncertainGroups: number;
  pendingGroups: number;
  f1: null;
  f1Note: string;
}

export function candidateMetrics(session: ReviewSession): CandidateMetrics {
  const judgments = Object.values(session.judgments);
  const reviewedPairs = judgments.filter((judgment) => judgment.humanLabel !== null).length;
  const samePairs = judgments.filter((judgment) => judgment.humanLabel === "same").length;
  const differentPairs = judgments.filter((judgment) => judgment.humanLabel === "different").length;
  const uncertainPairs = judgments.filter((judgment) => judgment.humanLabel === "uncertain").length;
  const scoredPairs = samePairs + differentPairs;
  const states = session.groups.map((group) => groupReviewState(session, group));
  return {
    candidateGroups: session.groups.length,
    candidatePairs: judgments.length,
    reviewedPairs,
    samePairs,
    differentPairs,
    uncertainPairs,
    pendingPairs: judgments.length - reviewedPairs,
    candidatePrecision: scoredPairs ? samePairs / scoredPairs : null,
    reviewedPairCoverage: judgments.length ? reviewedPairs / judgments.length : 0,
    acceptedGroups: states.filter((state) => state === "accepted").length,
    splitGroups: states.filter((state) => state === "split").length,
    uncertainGroups: states.filter((state) => state === "uncertain").length,
    pendingGroups: states.filter((state) => state === "unreviewed" || state === "partial").length,
    f1: null,
    f1Note:
      "В загруженном наборе есть только AI-предложенные группы (положительные пары). Для полноты нужны оценённые пары, которые AI не сгруппировал; без них recall и F1 не вычисляются корректно.",
  };
}
