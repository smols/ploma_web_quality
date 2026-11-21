import { z } from "zod";

const stringRecord = z.record(z.string(), z.string());

const qualityItemSchema = z.object({
  key: z.string().min(1),
  sourceId: z.string().min(1),
  entityType: z.literal("publication"),
  title: z.string().optional(),
  text: z.string(),
  category: z.string().optional(),
  metadata: stringRecord,
}).strict();

const qualityStorySchema = z.object({
  storyId: z.string().min(1),
  title: z.string(),
  description: z.string(),
  category: z.string().optional(),
  publicationKeys: z.array(z.string()).min(1),
}).strict();

const qualityJudgmentSchema = z.object({
  key: z.string().min(1),
  storyId: z.string().min(1),
  publicationKey: z.string().min(1),
  humanLabel: z.enum(["belongs", "not_belongs", "uncertain"]).nullable(),
  note: z.string(),
  updatedAt: z.string().datetime().nullable(),
}).strict();

export const qualitySessionSchema = z.object({
  schemaVersion: z.literal(1),
  taskType: z.literal("quality"),
  sessionId: z.string().uuid(),
  annotatorName: z.string().trim().min(1).max(120),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  currentStoryId: z.string().min(1).nullable().optional(),
  source: z.object({
    datasetIds: z.array(z.string()),
    versions: z.array(z.string()),
    runIds: z.array(z.string()),
    systemName: z.string(),
    sourceFiles: z.array(z.string()),
    sourceFormat: z.enum(["csv", "json"]),
    evaluationType: z.literal("quality"),
  }).strict(),
  stories: z.array(qualityStorySchema).min(1),
  items: z.record(z.string(), qualityItemSchema),
  judgments: z.record(z.string(), qualityJudgmentSchema),
}).strict().superRefine((session, context) => {
  const assignments = new Set<string>();
  const storyIds = new Set<string>();
  for (const [storyIndex, story] of session.stories.entries()) {
    if (storyIds.has(story.storyId)) {
      context.addIssue({ code: "custom", path: ["stories", storyIndex, "storyId"], message: "ID сюжета повторяется." });
    }
    storyIds.add(story.storyId);
    for (const publicationKey of story.publicationKeys) {
      if (!session.items[publicationKey]) {
        context.addIssue({
          code: "custom",
          path: ["stories", storyIndex, "publicationKeys"],
          message: "Сюжет ссылается на неизвестную публикацию.",
        });
      }
      const assignmentKey = JSON.stringify([story.storyId, publicationKey]);
      if (assignments.has(assignmentKey)) {
        context.addIssue({ code: "custom", path: ["stories", storyIndex, "publicationKeys"], message: "Публикация повторяется внутри quality-сессии." });
      }
      assignments.add(assignmentKey);
      if (!session.judgments[assignmentKey]) {
        context.addIssue({ code: "custom", path: ["judgments", assignmentKey], message: "Для публикации отсутствует оценка." });
      }
    }
  }
  if (session.currentStoryId && !storyIds.has(session.currentStoryId)) {
    context.addIssue({ code: "custom", path: ["currentStoryId"], message: "Текущий сюжет отсутствует в сессии." });
  }
  for (const [key, judgment] of Object.entries(session.judgments)) {
    if (
      key !== judgment.key ||
      !session.items[judgment.publicationKey] ||
      !assignments.has(JSON.stringify([judgment.storyId, judgment.publicationKey]))
    ) {
      context.addIssue({
        code: "custom",
        path: ["judgments", key],
        message: "Оценка ссылается на неизвестную публикацию или сюжет.",
      });
    }
  }
});

export type ValidQualitySession = z.infer<typeof qualitySessionSchema>;
