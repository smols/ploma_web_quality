export type EntityType = "story" | "publication";
export type HumanLabel = "same" | "different" | "uncertain" | null;
export type EvaluationType = "doubles" | "quality";
export type QualityLabel = "belongs" | "not_belongs" | "uncertain" | null;

export interface ReviewItem {
  key: string;
  sourceId: string;
  entityType: EntityType;
  title?: string;
  text: string;
  category?: string;
  metadata: Record<string, string>;
}

export interface ReviewGroup {
  id: string;
  sourceGroupId: string;
  entityType: EntityType;
  datasetId: string;
  version: string;
  runId: string;
  aiLabel?: "same" | "different";
  memberKeys: string[];
  metadata: Record<string, string>;
}

export interface PairJudgment {
  key: string;
  itemKeyA: string;
  itemKeyB: string;
  humanLabel: HumanLabel;
  note: string;
  updatedAt: string | null;
}

export interface SessionSource {
  datasetIds: string[];
  versions: string[];
  runIds: string[];
  systemName: string;
  sourceFiles: string[];
  sourceFormat: "csv" | "json";
  evaluationType?: EvaluationType;
}

export interface ReviewSession {
  schemaVersion: 1;
  sessionId: string;
  annotatorName: string;
  createdAt: string;
  updatedAt: string;
  source: SessionSource;
  items: Record<string, ReviewItem>;
  groups: ReviewGroup[];
  judgments: Record<string, PairJudgment>;
}

export interface ImportedCollection {
  source: SessionSource;
  items: Record<string, ReviewItem>;
  groups: ReviewGroup[];
}

export interface QualityStoryGroup {
  storyId: string;
  title: string;
  description: string;
  category?: string;
  publicationKeys: string[];
}

export interface ImportedQualityCollection {
  source: SessionSource;
  stories: QualityStoryGroup[];
  items: Record<string, ReviewItem>;
}

export interface QualityJudgment {
  key: string;
  storyId: string;
  publicationKey: string;
  humanLabel: QualityLabel;
  note: string;
  updatedAt: string | null;
}

export interface QualityReviewSession {
  schemaVersion: 1;
  taskType: "quality";
  sessionId: string;
  annotatorName: string;
  createdAt: string;
  updatedAt: string;
  currentStoryId?: string | null;
  source: SessionSource & { evaluationType: "quality" };
  stories: QualityStoryGroup[];
  items: Record<string, ReviewItem>;
  judgments: Record<string, QualityJudgment>;
}

export interface PairRef {
  key: string;
  itemKeyA: string;
  itemKeyB: string;
}

export interface SessionSummary {
  sessionId: string;
  annotatorName: string;
  datasetIds: string[];
  versions: string[];
  runIds: string[];
  sourceFiles: string[];
  groupCount: number;
  itemCount: number;
  updatedAt: string;
  relativePath: string;
  evaluationType?: EvaluationType;
}
