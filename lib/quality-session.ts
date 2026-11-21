import type {
  ImportedQualityCollection,
  QualityJudgment,
  QualityLabel,
  QualityReviewSession,
} from "@/lib/types";

function newSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    return (token === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

export function qualityJudgmentKey(storyId: string, publicationKey: string): string {
  return JSON.stringify([storyId, publicationKey]);
}

export function touchQualitySession(
  session: QualityReviewSession,
  currentStoryId: string | null = session.currentStoryId ?? null,
): QualityReviewSession {
  return { ...session, currentStoryId, updatedAt: new Date().toISOString() };
}

export function createQualitySession(
  imported: ImportedQualityCollection,
  annotatorName: string,
): QualityReviewSession {
  const now = new Date().toISOString();
  const judgments: Record<string, QualityJudgment> = {};
  for (const story of imported.stories) {
    for (const publicationKey of story.publicationKeys) {
      const key = qualityJudgmentKey(story.storyId, publicationKey);
      judgments[key] = {
        key,
        storyId: story.storyId,
        publicationKey,
        humanLabel: null,
        note: "",
        updatedAt: null,
      };
    }
  }
  return {
    schemaVersion: 1,
    taskType: "quality",
    sessionId: newSessionId(),
    annotatorName: annotatorName.trim(),
    createdAt: now,
    updatedAt: now,
    currentStoryId: imported.stories[0]?.storyId ?? null,
    source: { ...imported.source, evaluationType: "quality" },
    stories: imported.stories,
    items: imported.items,
    judgments,
  };
}

export function setQualityLabel(
  session: QualityReviewSession,
  judgmentKey: string,
  humanLabel: QualityLabel,
): QualityReviewSession {
  const current = session.judgments[judgmentKey];
  if (!current) return session;
  const now = new Date().toISOString();
  return {
    ...session,
    updatedAt: now,
    judgments: {
      ...session.judgments,
      [judgmentKey]: { ...current, humanLabel, updatedAt: now },
    },
  };
}

export function setQualityNote(
  session: QualityReviewSession,
  judgmentKey: string,
  note: string,
): QualityReviewSession {
  const current = session.judgments[judgmentKey];
  if (!current) return session;
  const now = new Date().toISOString();
  return {
    ...session,
    updatedAt: now,
    judgments: {
      ...session.judgments,
      [judgmentKey]: { ...current, note, updatedAt: now },
    },
  };
}
