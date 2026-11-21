import type { QualityReviewSession } from "@/lib/types";

export interface QualityMetrics {
  stories: number;
  assignments: number;
  reviewed: number;
  pending: number;
  belongs: number;
  notBelongs: number;
  uncertain: number;
  determined: number;
  assignmentPrecision: number | null;
  fullyReviewedStories: number;
}

export function calculateQualityMetrics(session: QualityReviewSession): QualityMetrics {
  const judgments = Object.values(session.judgments);
  const belongs = judgments.filter((judgment) => judgment.humanLabel === "belongs").length;
  const notBelongs = judgments.filter((judgment) => judgment.humanLabel === "not_belongs").length;
  const uncertain = judgments.filter((judgment) => judgment.humanLabel === "uncertain").length;
  const reviewed = belongs + notBelongs + uncertain;
  const determined = belongs + notBelongs;
  const fullyReviewedStories = session.stories.filter((story) =>
    story.publicationKeys.every((publicationKey) => {
      const label = session.judgments[JSON.stringify([story.storyId, publicationKey])]?.humanLabel;
      return label !== null && label !== undefined;
    }),
  ).length;
  return {
    stories: session.stories.length,
    assignments: judgments.length,
    reviewed,
    pending: judgments.length - reviewed,
    belongs,
    notBelongs,
    uncertain,
    determined,
    assignmentPrecision: determined ? belongs / determined : null,
    fullyReviewedStories,
  };
}
